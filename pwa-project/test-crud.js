// CRUD 功能測試腳本
const API_BASE = 'http://localhost:3001/api';

// 測試用員工資料
const testEmployee = {
  FirstName: '測試',
  LastName: '員工',
  Department: 'IT',
  Position: 'Developer',
  HireDate: '2024-01-01',
  BirthDate: '1990-01-01',
  Gender: '男',
  Email: 'test@example.com',
  PhoneNumber: '123-456-7890',
  Address: '測試地址 123',
  Status: '在職'
};

let createdEmployeeId = null;

// 輔助函數
async function makeRequest(url, options = {}) {
  try {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    });
    
    const result = await response.json();
    console.log(`${options.method || 'GET'} ${url}:`, response.status, result);
    return { success: response.ok, data: result, status: response.status };
  } catch (error) {
    console.error(`錯誤 ${options.method || 'GET'} ${url}:`, error.message);
    return { success: false, error: error.message };
  }
}

// 測試函數
async function testCreate() {
  console.log('\n🔹 測試 CREATE (新增員工)');
  const result = await makeRequest(`${API_BASE}/employees`, {
    method: 'POST',
    body: JSON.stringify(testEmployee)
  });
  
  if (result.success && result.data.employee) {
    createdEmployeeId = result.data.employee.EmployeeID;
    console.log('✅ 新增成功，員工 ID:', createdEmployeeId);
    return true;
  } else {
    console.log('❌ 新增失敗');
    return false;
  }
}

async function testRead() {
  console.log('\n🔹 測試 READ (讀取所有員工)');
  const result = await makeRequest(`${API_BASE}/employees`);
  
  if (result.success && Array.isArray(result.data)) {
    console.log(`✅ 讀取成功，共 ${result.data.length} 名員工`);
    if (result.data.length > 0) {
      console.log('第一筆資料:', result.data[0]);
    }
    return true;
  } else {
    console.log('❌ 讀取失敗');
    return false;
  }
}

async function testUpdate() {
  if (!createdEmployeeId) {
    console.log('\n🔹 跳過 UPDATE (沒有可更新的員工)');
    return false;
  }
  
  console.log('\n🔹 測試 UPDATE (更新員工)');
  const updatedData = {
    ...testEmployee,
    FirstName: '更新',
    Department: 'HR',
    Position: 'Manager'
  };
  
  const result = await makeRequest(`${API_BASE}/employees/${createdEmployeeId}`, {
    method: 'PUT',
    body: JSON.stringify(updatedData)
  });
  
  if (result.success) {
    console.log('✅ 更新成功');
    return true;
  } else {
    console.log('❌ 更新失敗');
    return false;
  }
}

async function testDelete() {
  if (!createdEmployeeId) {
    console.log('\n🔹 跳過 DELETE (沒有可刪除的員工)');
    return false;
  }
  
  console.log('\n🔹 測試 DELETE (刪除員工)');
  const result = await makeRequest(`${API_BASE}/employees/${createdEmployeeId}`, {
    method: 'DELETE'
  });
  
  if (result.success) {
    console.log('✅ 刪除成功');
    return true;
  } else {
    console.log('❌ 刪除失敗');
    return false;
  }
}

// 主測試函數
async function runCRUDTests() {
  console.log('🚀 開始 CRUD 功能測試...\n');
  
  const results = {
    create: await testCreate(),
    read: await testRead(),
    update: await testUpdate(),
    delete: await testDelete()
  };
  
  console.log('\n📊 測試結果摘要:');
  console.log('CREATE:', results.create ? '✅ 通過' : '❌ 失敗');
  console.log('READ:  ', results.read ? '✅ 通過' : '❌ 失敗');
  console.log('UPDATE:', results.update ? '✅ 通過' : '❌ 失敗');
  console.log('DELETE:', results.delete ? '✅ 通過' : '❌ 失敗');
  
  const passCount = Object.values(results).filter(Boolean).length;
  console.log(`\n總體結果: ${passCount}/4 項測試通過`);
  
  if (passCount === 4) {
    console.log('🎉 所有 CRUD 功能正常運作！');
  } else {
    console.log('⚠️  部分功能需要修復');
  }
}

// 執行測試
runCRUDTests().catch(console.error); 