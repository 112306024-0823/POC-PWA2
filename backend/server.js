const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const sql = require('mssql');
const Automerge = require('@automerge/automerge');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// 中間件
app.use(cors({
  origin: [
    'https://pwa-employee.vercel.app', // 實際 Vercel 前端域名
    'http://localhost:9000',
    'http://localhost:9200'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(bodyParser.json());
app.use(bodyParser.raw({ type: 'application/octet-stream', limit: '10mb' }));

// 根路由（避免 Render 顯示 Cannot GET /）
app.get('/', (req, res) => {
  res.type('text/plain').send('Employee API is running. Use /api/health');
});

// 資料庫配置 (從.env檔案讀取)
const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT, 10),
  database: process.env.DB_DATABASE,
  options: {
    encrypt: true,
    trustServerCertificate: true,
    enableArithAbort: true,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

// 全域變數存儲 CRDT 文檔（在生產環境中應該使用持久化存儲）
let currentDocument = Automerge.init();

// 輸入驗證函數
function validateEmployee(employee) {
  const errors = [];
  
  if (!employee.FirstName || employee.FirstName.trim().length === 0) {
    errors.push('FirstName is required');
  }
  if (!employee.LastName || employee.LastName.trim().length === 0) {
    errors.push('LastName is required');
  }
  if (employee.Email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(employee.Email)) {
    errors.push('Invalid email format');
  }
  if (employee.PhoneNumber && !/^[\d\-\+\(\)\s]+$/.test(employee.PhoneNumber)) {
    errors.push('Invalid phone number format');
  }
  
  return errors;
}

// 清理輸入數據
function sanitizeEmployee(employee) {
  // 安全轉換為字符串的輔助函數
  const toSafeString = (value) => {
    if (value === null || value === undefined) return '';
    return String(value).trim();
  };
  // 轉換為 JS Date 或 null（空字串或非法日期回傳 null）
  const toJsDateOrNull = (value) => {
    if (value === null || value === undefined) return null;
    const s = String(value).trim();
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  };

  return {
    EmployeeID: employee.EmployeeID,
    FirstName: toSafeString(employee.FirstName),
    LastName: toSafeString(employee.LastName),
    Department: toSafeString(employee.Department),
    Position: toSafeString(employee.Position),
    HireDate: toJsDateOrNull(employee.HireDate),
    BirthDate: toJsDateOrNull(employee.BirthDate),
    Gender: toSafeString(employee.Gender),
    Email: toSafeString(employee.Email),
    PhoneNumber: toSafeString(employee.PhoneNumber),
    Address: toSafeString(employee.Address),
    Status: toSafeString(employee.Status) || 'Active'
  };
}

// 初始化文檔結構
currentDocument = Automerge.change(currentDocument, doc => {
  doc.employees = {};
  doc.lastModified = Date.now();
});

// 連接資料庫
async function connectDB() {
  try {
    await sql.connect(dbConfig);
    console.log('Connected to SQL Server database');
    
    // 載入現有資料到 CRDT 文檔
    await loadExistingData();
  } catch (err) {
    console.error('Database connection failed:', err);
  }
}

// 載入現有資料到 CRDT 文檔
async function loadExistingData() {
  try {
    const result = await sql.query(`
      SELECT EmployeeID, FirstName, LastName, Department, Position, 
             HireDate, BirthDate, Gender, Email, PhoneNumber, Address, Status
      FROM [POC].[dbo].[Employee]
    `);
    
    currentDocument = Automerge.change(currentDocument, doc => {
      result.recordset.forEach(emp => {
        doc.employees[emp.EmployeeID] = {
          EmployeeID: emp.EmployeeID,
          FirstName: emp.FirstName || '',
          LastName: emp.LastName || '',
          Department: emp.Department || '',
          Position: emp.Position || '',
          HireDate: emp.HireDate ? emp.HireDate.toISOString().split('T')[0] : '',
          BirthDate: emp.BirthDate ? emp.BirthDate.toISOString().split('T')[0] : '',
          Gender: emp.Gender || '',
          Email: emp.Email || '',
          PhoneNumber: emp.PhoneNumber || '',
          Address: emp.Address || '',
          Status: (function(){
            const s = (emp.Status || '').toString();
            if (!s) return 'Active';
            if (s === '在職') return 'Active';
            if (s === '離職') return 'Inactive';
            return s;
          })()
        };
      });
      doc.lastModified = Date.now();
    });
    
    console.log(`Loaded ${result.recordset.length} employees into CRDT document`);
  } catch (err) {
    console.error('Failed to load existing data:', err);
  }
}

// 將 CRDT 文檔同步到資料庫
async function syncToDatabase() {
  const transaction = new sql.Transaction();

  try {
    await transaction.begin();
    const employees = currentDocument.employees;
    try {
      const deletedKeys = Object.entries(employees || {})
        .filter(([k, v]) => v && String(v.Status ?? '').trim().toLowerCase() === 'deleted')
        .map(([k]) => k);
      console.log(`🧹 準備同步：總筆數=${Object.keys(employees||{}).length}，刪除標記=${deletedKeys.length} ->`, deletedKeys);
    } catch {}

    for (const [employeeIdRaw, employee] of Object.entries(employees)) {
      // 先過濾掉 new-/temp- key
      if (employeeIdRaw.startsWith('new-') || employeeIdRaw.startsWith('temp-')) {
        console.log('跳過臨時員工:', employeeIdRaw);
        continue;
      }

      // 再轉數字 ID
      const employeeId = Number(employeeIdRaw);
      if (isNaN(employeeId) || employeeId <= 0) {
        console.warn('跳過無效 ID:', employeeIdRaw);
        continue;
      }

      // 刪除（狀態大小寫與空白容忍）
      const statusNorm = String(employee.Status ?? '').trim().toLowerCase();
      if (statusNorm === 'deleted') {
        console.log('準備刪除員工:', employeeId);
        await transaction.request()
          .input('EmployeeID', sql.Int, employeeId)
          .query(`DELETE FROM [POC].[dbo].[Employee] WHERE EmployeeID = @EmployeeID`);

        currentDocument = Automerge.change(currentDocument, doc => {
          delete doc.employees[employeeIdRaw];
          doc.lastModified = Date.now();
        });
        continue;
      }

      // 檢查是否存在
      const check = await transaction.request()
        .input('EmployeeID', sql.Int, employeeId)
        .query(`SELECT COUNT(*) as count FROM [POC].[dbo].[Employee] WHERE EmployeeID = @EmployeeID`);

      if (check.recordset[0].count > 0) {
        // 更新
        console.log('更新員工:', employeeId);
        const toJsDateOrNull = (v) => {
          if (!v) return null;
          const d = new Date(v);
          return isNaN(d.getTime()) ? null : d;
        };
        const safe = {
          FirstName: String(employee.FirstName ?? ''),
          LastName: String(employee.LastName ?? ''),
          Department: String(employee.Department ?? ''),
          Position: String(employee.Position ?? ''),
          HireDate: toJsDateOrNull(employee.HireDate),
          BirthDate: toJsDateOrNull(employee.BirthDate),
          Gender: String(employee.Gender ?? ''),
          Email: String(employee.Email ?? ''),
          PhoneNumber: String(employee.PhoneNumber ?? ''),
          Address: String(employee.Address ?? ''),
          Status: String(employee.Status ?? '在職'),
        };
        await transaction.request()
          .input('EmployeeID', sql.Int, employeeId)
          .input('FirstName', sql.NVarChar, safe.FirstName)
          .input('LastName', sql.NVarChar, safe.LastName)
          .input('Department', sql.NVarChar, safe.Department)
          .input('Position', sql.NVarChar, safe.Position)
          .input('HireDate', sql.Date, safe.HireDate)
          .input('BirthDate', sql.Date, safe.BirthDate)
          .input('Gender', sql.NVarChar, safe.Gender)
          .input('Email', sql.NVarChar, safe.Email)
          .input('PhoneNumber', sql.NVarChar, safe.PhoneNumber)
          .input('Address', sql.NVarChar, safe.Address)
          .input('Status', sql.NVarChar, safe.Status)
          .query(`
            UPDATE [POC].[dbo].[Employee] SET
              FirstName=@FirstName,
              LastName=@LastName,
              Department=@Department,
              Position=@Position,
              HireDate=@HireDate,
              BirthDate=@BirthDate,
              Gender=@Gender,
              Email=@Email,
              PhoneNumber=@PhoneNumber,
              Address=@Address,
              Status=@Status
            WHERE EmployeeID=@EmployeeID
          `);
      } else {
        // 插入（注意：EmployeeID 不手動指定）
        console.log('插入新員工:', employeeId);
        const toJsDateOrNull = (v) => {
          if (!v) return null;
          const d = new Date(v);
          return isNaN(d.getTime()) ? null : d;
        };
        const safeIns = {
          FirstName: String(employee.FirstName ?? ''),
          LastName: String(employee.LastName ?? ''),
          Department: String(employee.Department ?? ''),
          Position: String(employee.Position ?? ''),
          HireDate: toJsDateOrNull(employee.HireDate),
          BirthDate: toJsDateOrNull(employee.BirthDate),
          Gender: String(employee.Gender ?? ''),
          Email: String(employee.Email ?? ''),
          PhoneNumber: String(employee.PhoneNumber ?? ''),
          Address: String(employee.Address ?? ''),
          Status: String(employee.Status ?? '在職'),
        };
        await transaction.request()
          .input('FirstName', sql.NVarChar, safeIns.FirstName)
          .input('LastName', sql.NVarChar, safeIns.LastName)
          .input('Department', sql.NVarChar, safeIns.Department)
          .input('Position', sql.NVarChar, safeIns.Position)
          .input('HireDate', sql.Date, safeIns.HireDate)
          .input('BirthDate', sql.Date, safeIns.BirthDate)
          .input('Gender', sql.NVarChar, safeIns.Gender)
          .input('Email', sql.NVarChar, safeIns.Email)
          .input('PhoneNumber', sql.NVarChar, safeIns.PhoneNumber)
          .input('Address', sql.NVarChar, safeIns.Address)
          .input('Status', sql.NVarChar, safeIns.Status)
          .query(`
            INSERT INTO [POC].[dbo].[Employee] (
              FirstName, LastName, Department, Position,
              HireDate, BirthDate, Gender, Email, PhoneNumber, Address, Status
            ) VALUES (
              @FirstName, @LastName, @Department, @Position,
              @HireDate, @BirthDate, @Gender, @Email, @PhoneNumber, @Address, @Status
            )
          `);
      }
    }

    await transaction.commit();
    console.log('✅ Database synchronized successfully');
  } catch (err) {
    await transaction.rollback();
    console.error('❌ Database sync failed:', err);
    throw err;
  }
}



// API 路由

// 健康檢查
app.get('/api/health', async (req, res) => {
  const startedAt = Date.now();
  let dbConnected = false;
  let dbError = null;
  try {
    const pool = await sql.connect(dbConfig);
    const r = await pool.request().query('SELECT 1 AS ok');
    dbConnected = Array.isArray(r?.recordset) && r.recordset.length > 0;
  } catch (e) {
    dbError = e?.message || String(e);
  }

  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    db: {
      connected: dbConnected,
      error: dbError
    },
    crdt: {
      employeesCount: (() => { try { return Object.keys(currentDocument.employees || {}).length; } catch { return 0; } })(),
      lastModified: (() => { try { return currentDocument.lastModified || null; } catch { return null; } })()
    },
    responseMs: Date.now() - startedAt
  });
});

// 獲取 CRDT 文檔
app.get('/api/sync/document', (req, res) => {
  try {
    const documentBytes = Automerge.save(currentDocument);
    res.set('Content-Type', 'application/octet-stream');
    res.send(Buffer.from(documentBytes));
  } catch (err) {
    console.error('Failed to send document:', err);
    res.status(500).json({ error: 'Failed to retrieve document' });
  }
});

// 接收並合併 CRDT 文檔
app.post('/api/sync/document', async (req, res) => {
  try {
    const incomingBytes = new Uint8Array(req.body);
    const incomingDocument = Automerge.load(incomingBytes);
    
    // 合併文檔
    const oldDocument = currentDocument;
    currentDocument = Automerge.merge(currentDocument, incomingDocument);
    
    // 檢查是否有變更
    const hasChanges = !Automerge.equals(oldDocument, currentDocument);
    
    if (hasChanges) {
      // 調試：輸出合併後的 Deleted 條目
      try {
        const delIds = Object.entries(currentDocument.employees || {})
          .filter(([k, v]) => v && v.Status === 'Deleted')
          .map(([k]) => k);
        console.log('🔎 合併後 Deleted 條目 IDs:', delIds);
      } catch (e) {
        console.warn('無法列出 Deleted 條目:', e);
      }

      // POC 容錯：處理暫時員工與資料庫同步失敗時，不要讓整體 500
      try {
        await processOfflineEmployees();
      } catch (e) {
        console.warn('processOfflineEmployees 失敗，略過此次處理：', e);
      }
      
      try {
        // 同步到資料庫（只處理已有 ID 的更新/刪除）
        await syncToDatabase();
        console.log('Document merged and synced to database');
      } catch (e) {
        console.warn('syncToDatabase 失敗（可能是 DB 未連線或權限問題），暫時略過：', e);
      }
    }
    
    res.json({ 
      success: true, 
      merged: hasChanges,
      timestamp: Date.now()
    });
  } catch (err) {
    console.error('Failed to merge document:', err);
    res.status(500).json({ error: 'Failed to merge document' });
  }
});

// 獲取所有員工（傳統 REST API）
app.get('/api/employees', async (req, res) => {
  try {
    console.log('API: 正在執行員工查詢...');
    const pool = await sql.connect(dbConfig);
    const result = await pool.request().query(`
      SELECT EmployeeID, FirstName, LastName, Department, Position, 
             HireDate, BirthDate, Gender, Email, PhoneNumber, Address, Status
      FROM [POC].[dbo].[Employee]
      ORDER BY FirstName, LastName
    `);
    
    console.log(`API: 查詢完成，找到 ${result.recordset.length} 名員工`);
    console.log('API: 第一筆資料:', result.recordset[0] || 'No records');
    
    res.json(result.recordset);
  } catch (err) {
    console.error('Failed to fetch employees:', err);
    console.error('API 錯誤詳情:', err.message);

    // POC Fallback：改回傳目前 CRDT 狀態，避免 500 讓前端卡住
    try {
      const employeesFromCrdt = Object.entries(currentDocument.employees)
        .filter(([key, emp]) => {
          // 跳過臨時 key 與刪除紀錄
          if (typeof key === 'string' && (key.startsWith('new-') || key.startsWith('temp-'))) return false;
          const e = emp || {};
          const id = Number(e.EmployeeID ?? 0);
          const status = String(e.Status ?? 'Active').toLowerCase();
          if (!Number.isInteger(id) || id <= 0) return false;
          if (status === 'deleted') return false;
          return true;
        })
        .map(([, emp]) => emp);

      console.warn('DB 失敗，回傳 CRDT 快照做為暫時資料。筆數：', employeesFromCrdt.length);
      return res.status(200).json(employeesFromCrdt);
    } catch (fallbackErr) {
      console.error('Fallback 也失敗：', fallbackErr);
      return res.status(500).json({ error: 'Failed to fetch employees', details: err.message });
    }
  }
});

// 新增員工（傳統 REST API）
app.post('/api/employees', async (req, res) => {
  try {
    console.log('POST /api/employees - 收到請求:', req.body);
    
    const employee = req.body;
    
    // 基本驗證
    if (!employee.FirstName || !employee.LastName) {
      return res.status(400).json({ 
        error: 'FirstName and LastName are required' 
      });
    }
    
    console.log('準備插入員工資料:', employee);
    
    // 使用參數化查詢來防止 SQL 注入
    const sanitized = sanitizeEmployee(employee);
    const request = new sql.Request();
    const result = await request
      .input('FirstName', sql.NVarChar, sanitized.FirstName)
      .input('LastName', sql.NVarChar, sanitized.LastName)
      .input('Department', sql.NVarChar, sanitized.Department)
      .input('Position', sql.NVarChar, sanitized.Position)
      .input('HireDate', sql.Date, sanitized.HireDate)
      .input('BirthDate', sql.Date, sanitized.BirthDate)
      .input('Gender', sql.NVarChar, sanitized.Gender)
      .input('Email', sql.NVarChar, sanitized.Email)
      .input('PhoneNumber', sql.NVarChar, sanitized.PhoneNumber)
      .input('Address', sql.NVarChar, sanitized.Address)
      .input('Status', sql.NVarChar, sanitized.Status)
      .query(`
        INSERT INTO [POC].[dbo].[Employee] (
          FirstName, LastName, Department, Position,
          HireDate, BirthDate, Gender, Email, PhoneNumber, Address, Status
        )
        OUTPUT INSERTED.EmployeeID
        VALUES (
          @FirstName, @LastName, @Department, @Position,
          @HireDate, @BirthDate, @Gender, @Email, @PhoneNumber, @Address, @Status
        )
      `);
    
    console.log('SQL 插入成功:', result);
    
    // 取得自動生成的 EmployeeID
    const employeeId = result.recordset[0].EmployeeID;
    console.log('新生成的 EmployeeID:', employeeId);
    
    const newEmployee = {
      EmployeeID: employeeId,
      FirstName: employee.FirstName || '',
      LastName: employee.LastName || '',
      Department: employee.Department || '',
      Position: employee.Position || '',
      HireDate: employee.HireDate || null,
      BirthDate: employee.BirthDate || null,
      Gender: employee.Gender || '',
      Email: employee.Email || '',
      PhoneNumber: employee.PhoneNumber || '',
      Address: employee.Address || '',
      Status: employee.Status || 'Active'
    };
    
    // 更新 CRDT 文檔
    currentDocument = Automerge.change(currentDocument, doc => {
      doc.employees[employeeId] = newEmployee;
      doc.lastModified = Date.now();
    });
    
    console.log('CRDT 文檔已更新');
    
    res.json({ success: true, employee: newEmployee });
  } catch (err) {
    console.error('Failed to create employee:', err);
    res.status(500).json({ error: 'Failed to create employee' });
  }
});

// 更新員工（傳統 REST API）
app.put('/api/employees/:id', async (req, res) => {
  try {
    const employeeId = req.params.id;
    const employee = req.body;
    
    console.log('PUT /api/employees/:id - 收到請求:', { employeeId, employee });
    
    // 基本驗證
    if (!employee.FirstName || !employee.LastName) {
      return res.status(400).json({ 
        error: 'FirstName and LastName are required' 
      });
    }
    
    // 使用參數化查詢來防止 SQL 注入
    const sanitized = sanitizeEmployee(employee);
    const request = new sql.Request();
    const result = await request
      .input('EmployeeID', sql.Int, employeeId)
      .input('FirstName', sql.NVarChar, sanitized.FirstName)
      .input('LastName', sql.NVarChar, sanitized.LastName)
      .input('Department', sql.NVarChar, sanitized.Department)
      .input('Position', sql.NVarChar, sanitized.Position)
      .input('HireDate', sql.Date, sanitized.HireDate)
      .input('BirthDate', sql.Date, sanitized.BirthDate)
      .input('Gender', sql.NVarChar, sanitized.Gender)
      .input('Email', sql.NVarChar, sanitized.Email)
      .input('PhoneNumber', sql.NVarChar, sanitized.PhoneNumber)
      .input('Address', sql.NVarChar, sanitized.Address)
      .input('Status', sql.NVarChar, sanitized.Status)
      .query(`
        UPDATE [POC].[dbo].[Employee] SET
          FirstName = @FirstName,
          LastName = @LastName,
          Department = @Department,
          Position = @Position,
          HireDate = @HireDate,
          BirthDate = @BirthDate,
          Gender = @Gender,
          Email = @Email,
          PhoneNumber = @PhoneNumber,
          Address = @Address,
          Status = @Status
        WHERE EmployeeID = @EmployeeID
      `);
    
    console.log('SQL 更新成功:', result);
    
    const updatedEmployee = {
      EmployeeID: employeeId,
      FirstName: employee.FirstName || '',
      LastName: employee.LastName || '',
      Department: employee.Department || '',
      Position: employee.Position || '',
      HireDate: employee.HireDate || null,
      BirthDate: employee.BirthDate || null,
      Gender: employee.Gender || '',
      Email: employee.Email || '',
      PhoneNumber: employee.PhoneNumber || '',
      Address: employee.Address || '',
      Status: employee.Status || '在職'
    };
    
    // 更新 CRDT 文檔
    currentDocument = Automerge.change(currentDocument, doc => {
      doc.employees[employeeId] = updatedEmployee;
      doc.lastModified = Date.now();
    });
    
    console.log('CRDT 文檔已更新');
    
    res.json({ success: true, employee: updatedEmployee });
  } catch (err) {
    console.error('Failed to update employee:', err);
    res.status(500).json({ error: 'Failed to update employee' });
  }
});

// 刪除員工（傳統 REST API）
app.delete('/api/employees/:id', async (req, res) => {
  try {
    const employeeId = req.params.id;
    
    console.log('DELETE /api/employees/:id - 收到請求:', { employeeId });
    
    // 使用參數化查詢來防止 SQL 注入
    const request = new sql.Request();
    const result = await request
      .input('EmployeeID', sql.Int, employeeId)
      .query(`DELETE FROM [POC].[dbo].[Employee] WHERE EmployeeID = @EmployeeID`);
    
    console.log('SQL 刪除成功:', result);
    
    // 更新 CRDT 文檔
    currentDocument = Automerge.change(currentDocument, doc => {
      delete doc.employees[employeeId];
      doc.lastModified = Date.now();
    });
    
    console.log('CRDT 文檔已更新，員工已刪除');
    
    res.json({ success: true, deletedId: employeeId });
  } catch (err) {
    console.error('Failed to delete employee:', err);
    res.status(500).json({ error: 'Failed to delete employee' });
  }
});

// 處理離線新增的員工
async function processOfflineEmployees() {
  const employees = currentDocument.employees;
  const newEmployees = [];
  
  // 找出所有新增的員工：
  // 1) 以 new- 開頭的鍵（離線建立）
  // 2) EmployeeID <= 0（本地暫時負數或 0）
  for (const [employeeKey, employee] of Object.entries(employees)) {
    const isNewKey = typeof employeeKey === 'string' && employeeKey.startsWith('new-');
    const isTempId = typeof employee?.EmployeeID === 'number' && employee.EmployeeID <= 0;
    if (isNewKey || isTempId) {
      newEmployees.push({ key: employeeKey, employee });
    }
  }
  
  console.log('發現離線新增的員工:', newEmployees.length, '個');
  
  // 為每個新員工生成真實 ID 並插入資料庫
  for (const { key, employee } of newEmployees) {
    try {
      const sanitized = sanitizeEmployee(employee);

      // 使用參數化查詢插入新員工
      const request = new sql.Request();
      const result = await request
        .input('FirstName', sql.NVarChar, sanitized.FirstName)
        .input('LastName', sql.NVarChar, sanitized.LastName)
        .input('Department', sql.NVarChar, sanitized.Department)
        .input('Position', sql.NVarChar, sanitized.Position)
        .input('HireDate', sql.Date, sanitized.HireDate)
        .input('BirthDate', sql.Date, sanitized.BirthDate)
        .input('Gender', sql.NVarChar, sanitized.Gender)
        .input('Email', sql.NVarChar, sanitized.Email)
        .input('PhoneNumber', sql.NVarChar, sanitized.PhoneNumber)
        .input('Address', sql.NVarChar, sanitized.Address)
        .input('Status', sql.NVarChar, sanitized.Status)
        .query(`
          INSERT INTO [POC].[dbo].[Employee] (
            FirstName, LastName, Department, Position,
            HireDate, BirthDate, Gender, Email, PhoneNumber, Address, Status
          )
          OUTPUT INSERTED.EmployeeID
          VALUES (
            @FirstName, @LastName, @Department, @Position,
            @HireDate, @BirthDate, @Gender, @Email, @PhoneNumber, @Address, @Status
          )
        `);

      const newEmployeeId = result.recordset[0].EmployeeID;
      console.log('離線員工已插入，新 ID:', newEmployeeId, '原鍵:', key);
      
      // 更新 CRDT 文檔，將臨時鍵替換為真實 ID
      currentDocument = Automerge.change(currentDocument, doc => {
        // 建立新物件，避免引用同一個 existing object 觸發 Automerge RangeError
        const updatedEmployee = {
          EmployeeID: newEmployeeId,
          FirstName: String(employee.FirstName || ''),
          LastName: String(employee.LastName || ''),
          Department: String(employee.Department || ''),
          Position: String(employee.Position || ''),
          HireDate: employee.HireDate || null,
          BirthDate: employee.BirthDate || null,
          Gender: String(employee.Gender || ''),
          Email: String(employee.Email || ''),
          PhoneNumber: String(employee.PhoneNumber || ''),
          Address: String(employee.Address || ''),
          Status: String(employee.Status || 'Active')
        };
        delete doc.employees[key];
        doc.employees[String(newEmployeeId)] = updatedEmployee;
        doc.lastModified = Date.now();
      });
      
    } catch (err) {
      console.error('處理離線員工失敗:', key, err);
    }
  }
}

// 錯誤處理中間件
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something broke!' });
});

// 啟動服務器
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await connectDB();
});
// 優雅關閉
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await sql.close();
  process.exit(0);
}); 
