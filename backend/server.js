const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');
const Automerge = require('@automerge/automerge');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// 中間件
app.use(cors({
  origin: [
    'https://poc-pwa-2-nine.vercel.app', // 實際 Vercel 前端域名
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

// Supabase 設定 (從.env檔案讀取)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMP_TABLE = process.env.EMP_TABLE || 'employee';

/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
let supabase = null;

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
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    }
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    console.log('Connected to Supabase');
    await loadExistingData();
  } catch (err) {
    console.error('Database connection failed:', err);
  }
}

// 載入現有資料到 CRDT 文檔
async function loadExistingData() {
  try {
    const { data, error } = await supabase
      .from(EMP_TABLE)
      .select('employee_id, first_name, last_name, department, position, hire_date, birth_date, gender, email, phone_number, address, status');
    if (error) throw error;

    currentDocument = Automerge.change(currentDocument, doc => {
      (data || []).forEach(row => {
        doc.employees[row.employee_id] = {
          EmployeeID: row.employee_id,
          FirstName: row.first_name || '',
          LastName: row.last_name || '',
          Department: row.department || '',
          Position: row.position || '',
          HireDate: row.hire_date ? new Date(row.hire_date).toISOString().split('T')[0] : '',
          BirthDate: row.birth_date ? new Date(row.birth_date).toISOString().split('T')[0] : '',
          Gender: row.gender || '',
          Email: row.email || '',
          PhoneNumber: row.phone_number || '',
          Address: row.address || '',
          Status: row.status || 'Active'
        };
      });
      doc.lastModified = Date.now();
    });

    console.log(`Loaded ${Array.isArray(data) ? data.length : 0} employees into CRDT document`);
  } catch (err) {
    console.error('Failed to load existing data:', err);
  }
}

async function syncToDatabase() {
  const employees = currentDocument.employees || {};
  try {
    for (const [employeeIdRaw, employee] of Object.entries(employees)) {
      if (employeeIdRaw.startsWith('new-') || employeeIdRaw.startsWith('temp-')) {
        console.log('跳過臨時員工:', employeeIdRaw);
        continue;
      }
      const employeeId = Number(employeeIdRaw);
      if (!Number.isInteger(employeeId) || employeeId <= 0) {
        console.warn('跳過無效 ID:', employeeIdRaw);
        continue;
      }

      const statusNorm = String(employee.Status ?? '').trim().toLowerCase();
      if (statusNorm === 'deleted') {
        console.log('準備刪除員工:', employeeId);
        const { error: delErr } = await supabase
          .from(EMP_TABLE)
          .delete()
          .eq('employee_id', employeeId);
        if (delErr) throw delErr;

        currentDocument = Automerge.change(currentDocument, doc => {
          delete doc.employees[employeeIdRaw];
          doc.lastModified = Date.now();
        });
        continue;
      }

      const payload = {
        employee_id: employeeId,
        first_name: String(employee.FirstName ?? ''),
        last_name: String(employee.LastName ?? ''),
        department: String(employee.Department ?? ''),
        position: String(employee.Position ?? ''),
        hire_date: employee.HireDate ? new Date(employee.HireDate) : null,
        birth_date: employee.BirthDate ? new Date(employee.BirthDate) : null,
        gender: String(employee.Gender ?? ''),
        email: String(employee.Email ?? ''),
        phone_number: String(employee.PhoneNumber ?? ''),
        address: String(employee.Address ?? ''),
        status: String(employee.Status ?? 'Active'),
      };

      const { error: upsertErr } = await supabase
        .from(EMP_TABLE)
        .upsert(payload, { onConflict: 'employee_id' });
      if (upsertErr) throw upsertErr;
    }
    console.log('✅ Database synchronized successfully');
  } catch (err) {
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
    const { error } = await supabase
      .from(EMP_TABLE)
      .select('employee_id', { count: 'exact', head: true })
      .limit(1);
    dbConnected = !error;
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
    const { data, error } = await supabase
      .from(EMP_TABLE)
      .select('employee_id, first_name, last_name, department, position, hire_date, birth_date, gender, email, phone_number, address, status')
      .order('first_name', { ascending: true })
      .order('last_name', { ascending: true });
    if (error) throw error;

    const mapped = (data || []).map((r) => ({
      EmployeeID: r.employee_id,
      FirstName: r.first_name || '',
      LastName: r.last_name || '',
      Department: r.department || '',
      Position: r.position || '',
      HireDate: r.hire_date ? new Date(r.hire_date).toISOString().split('T')[0] : '',
      BirthDate: r.birth_date ? new Date(r.birth_date).toISOString().split('T')[0] : '',
      Gender: r.gender || '',
      Email: r.email || '',
      PhoneNumber: r.phone_number || '',
      Address: r.address || '',
      Status: r.status || 'Active',
    }));

    console.log(`API: 查詢完成，找到 ${mapped.length} 名員工`);
    console.log('API: 第一筆資料:', mapped[0] || 'No records');
    res.json(mapped);
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
    if (!employee.FirstName || !employee.LastName) {
      return res.status(400).json({ error: 'FirstName and LastName are required' });
    }

    const sanitized = sanitizeEmployee(employee);
    const payload = {
      first_name: sanitized.FirstName,
      last_name: sanitized.LastName,
      department: sanitized.Department,
      position: sanitized.Position,
      hire_date: sanitized.HireDate,
      birth_date: sanitized.BirthDate,
      gender: sanitized.Gender,
      email: sanitized.Email,
      phone_number: sanitized.PhoneNumber,
      address: sanitized.Address,
      status: sanitized.Status,
    };

    const { data, error } = await supabase
      .from(EMP_TABLE)
      .insert(payload)
      .select('employee_id, first_name, last_name, department, position, hire_date, birth_date, gender, email, phone_number, address, status')
      .single();
    if (error) throw error;

    const newEmployee = {
      EmployeeID: data.employee_id,
      FirstName: data.first_name || '',
      LastName: data.last_name || '',
      Department: data.department || '',
      Position: data.position || '',
      HireDate: data.hire_date ? new Date(data.hire_date).toISOString().split('T')[0] : '',
      BirthDate: data.birth_date ? new Date(data.birth_date).toISOString().split('T')[0] : '',
      Gender: data.gender || '',
      Email: data.email || '',
      PhoneNumber: data.phone_number || '',
      Address: data.address || '',
      Status: data.status || 'Active'
    };

    currentDocument = Automerge.change(currentDocument, doc => {
      doc.employees[String(newEmployee.EmployeeID)] = newEmployee;
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
    const employeeId = Number(req.params.id);
    const employee = req.body;
    
    console.log('PUT /api/employees/:id - 收到請求:', { employeeId, employee });
    
    if (!employee.FirstName || !employee.LastName) {
      return res.status(400).json({ error: 'FirstName and LastName are required' });
    }
    
    const sanitized = sanitizeEmployee(employee);
    const payload = {
      first_name: sanitized.FirstName,
      last_name: sanitized.LastName,
      department: sanitized.Department,
      position: sanitized.Position,
      hire_date: sanitized.HireDate,
      birth_date: sanitized.BirthDate,
      gender: sanitized.Gender,
      email: sanitized.Email,
      phone_number: sanitized.PhoneNumber,
      address: sanitized.Address,
      status: sanitized.Status,
    };
    const { data, error } = await supabase
      .from(EMP_TABLE)
      .update(payload)
      .eq('employee_id', employeeId)
      .select('employee_id, first_name, last_name, department, position, hire_date, birth_date, gender, email, phone_number, address, status')
      .single();
    if (error) throw error;

    const updatedEmployee = {
      EmployeeID: data.employee_id,
      FirstName: data.first_name || '',
      LastName: data.last_name || '',
      Department: data.department || '',
      Position: data.position || '',
      HireDate: data.hire_date ? new Date(data.hire_date).toISOString().split('T')[0] : '',
      BirthDate: data.birth_date ? new Date(data.birth_date).toISOString().split('T')[0] : '',
      Gender: data.gender || '',
      Email: data.email || '',
      PhoneNumber: data.phone_number || '',
      Address: data.address || '',
      Status: data.status || 'Active'
    };
    
    currentDocument = Automerge.change(currentDocument, doc => {
      doc.employees[String(employeeId)] = updatedEmployee;
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
    const employeeId = Number(req.params.id);
    
    console.log('DELETE /api/employees/:id - 收到請求:', { employeeId });

    const { error } = await supabase
      .from(EMP_TABLE)
      .delete()
      .eq('employee_id', employeeId);
    if (error) throw error;

    currentDocument = Automerge.change(currentDocument, doc => {
      delete doc.employees[String(employeeId)];
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
  
  // 為每個新員工生成真實 ID 並插入資料庫（改用 Supabase）
  for (const { key, employee } of newEmployees) {
    try {
      const sanitized = sanitizeEmployee(employee);
      const payload = {
        first_name: sanitized.FirstName,
        last_name: sanitized.LastName,
        department: sanitized.Department,
        position: sanitized.Position,
        hire_date: sanitized.HireDate,
        birth_date: sanitized.BirthDate,
        gender: sanitized.Gender,
        email: sanitized.Email,
        phone_number: sanitized.PhoneNumber,
        address: sanitized.Address,
        status: sanitized.Status,
      };
      const { data, error } = await supabase
        .from(EMP_TABLE)
        .insert(payload)
        .select('employee_id, first_name, last_name, department, position, hire_date, birth_date, gender, email, phone_number, address, status')
        .single();
      if (error) throw error;

      const newEmployeeId = data.employee_id;
      console.log('離線員工已插入，新 ID:', newEmployeeId, '原鍵:', key);
      
      // 更新 CRDT 文檔，將臨時鍵替換為真實 ID
      currentDocument = Automerge.change(currentDocument, doc => {
        const updatedEmployee = {
          EmployeeID: data.employee_id,
          FirstName: data.first_name || '',
          LastName: data.last_name || '',
          Department: data.department || '',
          Position: data.position || '',
          HireDate: data.hire_date ? new Date(data.hire_date).toISOString().split('T')[0] : '',
          BirthDate: data.birth_date ? new Date(data.birth_date).toISOString().split('T')[0] : '',
          Gender: data.gender || '',
          Email: data.email || '',
          PhoneNumber: data.phone_number || '',
          Address: data.address || '',
          Status: data.status || 'Active'
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
  process.exit(0);
}); 
