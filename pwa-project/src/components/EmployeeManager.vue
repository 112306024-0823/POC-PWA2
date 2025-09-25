<template>
  <div class="employee-manager">
    <!-- 簡化的狀態指示器 -->
    <div class="status-bar q-pa-sm">
      <div class="row items-center justify-between">
        <div class="col">
          <div class="row items-center q-gutter-sm">
            <q-icon 
              :name="statusIcon" 
              :color="statusColor"
              size="sm"
            />
            <span class="text-caption" :class="`text-${statusColor}`">
              {{ statusText }}
            </span>
            <q-badge 
              v-if="pendingChanges > 0" 
              :label="pendingChanges" 
              color="orange" 
              rounded
            />
          </div>
        </div>
        <div class="col-auto">
          <q-btn-group flat>
            <q-btn 
              flat 
              dense
              icon="refresh" 
              @click="handleRefresh"
            >
              <q-tooltip>重新載入</q-tooltip>
            </q-btn>
          </q-btn-group>
        </div>
      </div>
    </div>

    <!-- 主要操作區域 -->
    <div class="main-content">
      <!-- 搜尋和新增區域 -->
      <div class="action-bar q-pa-md">
        <div class="row items-center q-gutter-md">
      <div class="col">
        <q-input
          v-model="searchText"
              placeholder="搜尋員工姓名、部門或職位..."
              outlined
          dense
          clearable
              class="search-input"
        >
              <template #prepend>
            <q-icon name="search" />
          </template>
        </q-input>
      </div>
        <q-btn 
          color="primary" 
            icon="person_add" 
          label="新增員工"
            class="add-btn"
            :loading="saving"
          @click="openAddDialog"
        />
      </div>
    </div>

    <!-- 員工列表 -->
      <div class="table-container">
    <q-table
      :rows="filteredEmployees"
      :columns="columns"
      row-key="EmployeeID"
      :loading="loading"
      flat
      bordered
          :rows-per-page-options="[10, 25, 50]"
          :pagination="{ rowsPerPage: 25 }"
          class="employee-table"
        >
          <!-- 狀態欄位自定義顯示 -->
          <template #body-cell-Status="props">
            <q-td :props="props">
              <q-badge 
                :color="props.value === 'Active' ? 'green' : 'red'"
                :label="props.value === 'Active' ? '在職' : '離職'"
                rounded
              />
            </q-td>
          </template>

          <!-- 操作按鈕 -->
          <template #body-cell-actions="props">
        <q-td :props="props">
              <q-btn-group flat>
          <q-btn
            flat
            round
            dense
            icon="edit"
            color="primary"
                  size="sm"
            @click="editEmployee(props.row)"
                >
                  <q-tooltip>編輯</q-tooltip>
                </q-btn>
          <q-btn
            flat
            round
            dense
            icon="delete"
            color="negative"
                  size="sm"
            @click="confirmDelete(props.row)"
                >
                  <q-tooltip>刪除</q-tooltip>
                </q-btn>
              </q-btn-group>
        </q-td>
      </template>

          <!-- 空狀態 -->
          <template #no-data>
            <div class="full-width row flex-center text-grey-6 q-gutter-sm">
              <q-icon name="inbox" size="2em" />
              <span>沒有找到員工資料</span>
            </div>
          </template>
    </q-table>
      </div>
    </div>

    <!-- 新增/編輯員工資料 -->
    <q-dialog v-model="showDialog" persistent>
      <q-card style="min-width: 500px; max-width: 600px">
        <q-card-section class="row items-center q-pb-none">
          <div class="text-h6">{{ isEditing ? '編輯員工' : '新增員工' }}</div>
          <q-space />
          <q-btn v-close-popup icon="close" flat round dense />
        </q-card-section>

        <q-card-section class="q-pt-none">
          <div class="row q-gutter-sm">
            <div class="col-5">
              <q-input
                v-model="currentEmployee.FirstName"
                label="名 *"
                outlined
                dense
                :rules="[val => !!val || '必填欄位']"
              />
            </div>
            <div class="col-5">
              <q-input
                v-model="currentEmployee.LastName"
                label="姓 *"
                outlined
                dense
                :rules="[val => !!val || '必填欄位']"
              />
            </div>
          </div>

          <div class="row q-gutter-sm q-mt-sm">
            <div class="col-5">
              <q-input
                v-model="currentEmployee.Department"
                label="部門"
                outlined
                dense
              />
            </div>
            <div class="col-5">
              <q-input
                v-model="currentEmployee.Position"
                label="職位"
                outlined
                dense
              />
            </div>
          </div>

          <div class="row q-gutter-sm q-mt-sm">
            <div class="col-5">
              <q-input
                v-model="currentEmployee.Email"
                label="電子郵件"
                type="email"
                outlined
                dense
              />
            </div>
            <div class="col-5">
              <q-input
                v-model="currentEmployee.PhoneNumber"
                label="電話號碼"
                outlined
                dense
              />
            </div>
          </div>

          <div class="row q-gutter-sm q-mt-sm">
            <div class="col-5">
              <q-select
                v-model="currentEmployee.Gender"
                :options="genderOptions"
                option-value="value"
                option-label="label"
                emit-value
                map-options
                label="性別"
                outlined
                dense
                clearable
              />
            </div>
            <div class="col-5">
              <q-select
                v-model="currentEmployee.Status"
                :options="statusOptions"
                option-value="value"
                option-label="label"
                label="狀態"
                outlined
                dense
                emit-value
                map-options
              />
            </div>
          </div>

          <div class="row q-gutter-sm q-mt-sm">
            <div class="col-5">
              <q-input
                v-model="currentEmployee.HireDate"
                label="到職日期"
                type="date"
                outlined
                dense
              />
            </div>
            <div class="col-5">
              <q-input
                v-model="currentEmployee.BirthDate"
                label="生日"
                type="date"
                outlined
                dense
              />
            </div>
          </div>

          <div class="q-mt-sm">
            <q-input
              v-model="currentEmployee.Address"
              label="地址"
              outlined
              dense
              type="textarea"
              rows="2"
            />
          </div>
        </q-card-section>

        <q-card-actions align="right" class="q-pa-md">
          <q-btn flat label="取消" @click="closeDialog" />
          <q-btn 
            color="primary" 
            :label="isEditing ? '更新' : '新增'"
            :loading="saving"
            :disable="!isFormValid"
            @click="saveEmployee"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- 刪除確認對話框 -->
    <q-dialog v-model="showDeleteConfirm">
      <q-card>
        <q-card-section>
          <div class="text-h6">確認刪除</div>
        </q-card-section>
        <q-card-section>
          <div class="text-body1">
            確定要刪除員工 
            <strong>{{ employeeToDelete?.FirstName }} {{ employeeToDelete?.LastName }}</strong> 嗎？
          </div>
          <div class="text-caption text-grey-6 q-mt-sm">
            此操作無法復原
          </div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="取消" @click="showDeleteConfirm = false" />
          <q-btn 
            color="negative" 
            label="刪除" 
            :loading="deleting"
            @click="deleteEmployee"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useQuasar } from 'quasar';
import { db } from '../services/database';
import { syncService } from '../services/sync';
import type { Employee } from '../types/employee';

// 後端 API 基底網址（用於除錯拉資料等非同步流程）
const API_BASE = (() => {
  const raw = import.meta.env?.VITE_API_BASE || 'http://localhost:3001/api';
  if (raw.endsWith('/api')) return raw;
  return `${String(raw).replace(/\/+$/, '')}/api`;
})();

const $q = useQuasar();

// 安全的通知函數
const notify = (type: 'positive' | 'negative' | 'warning' | 'info', message: string) => {
  if ($q?.notify) {
    $q.notify({
      type,
      message,
      position: 'top',
      timeout: 3000
    });
  } 
};

// 定義原始員工數據類型（可能包含各種格式的數據）
interface RawEmployeeData {
  EmployeeID?: string | number;
  FirstName?: string;
  LastName?: string;
  Department?: string;
  Position?: string;
  HireDate?: string | Date;
  BirthDate?: string | Date;
  Gender?: string;
  Email?: string;
  PhoneNumber?: string;
  Address?: string;
  Status?: string;
}

// 安全的日期轉換函數
const formatDateToString = (date: string | Date | undefined | null): string => {
  if (!date) return '';
  try {
    // 如果已經是正確的格式（YYYY-MM-DD），直接返回
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return date;
    }
    
    const dateObj = new Date(date);
    if (isNaN(dateObj.getTime())) return '';
    
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    
    return `${year}-${month}-${day}`;
  } catch {
    return '';
  }
};

// 定義可能的選項類型
type SelectOption = {
  label: string;
  value: string;
};

// 清理員工數據，確保可以被 IndexedDB 序列化
const cleanEmployeeData = (employee: RawEmployeeData): Employee => {
  // 特殊處理可能是對象的欄位
  const cleanGender = (gender: string | SelectOption | undefined | null): string => {
    if (!gender) return '';
    if (typeof gender === 'string') return gender;
    if (typeof gender === 'object') {
      if (gender.value) return String(gender.value);
      // 如果是對象但沒有 value 屬性，返回空字符串而不是 [object Object]
      return '';
    }
    return '';
  };

  const cleanStatus = (status: string | SelectOption | undefined | null): string => {
    if (!status) return 'Active';
    if (typeof status === 'string') return status;
    if (typeof status === 'object') {
      if (status.value) return String(status.value);
      // 如果是對象但沒有 value 屬性，返回預設值而不是 [object Object]
      return 'Active';
    }
    return 'Active';
  };

  return {
    EmployeeID: Number(employee.EmployeeID) || 0,
    FirstName: String(employee.FirstName || ''),
    LastName: String(employee.LastName || ''),
    Department: String(employee.Department || ''),
    Position: String(employee.Position || ''),
    HireDate: formatDateToString(employee.HireDate),
    BirthDate: formatDateToString(employee.BirthDate),
    Gender: cleanGender(employee.Gender),
    Email: String(employee.Email || ''),
    PhoneNumber: String(employee.PhoneNumber || ''),
    Address: String(employee.Address || ''),
    Status: cleanStatus(employee.Status)
  };
};

// 資料狀態
const employees = ref<Employee[]>([]);
const loading = ref(false);
const saving = ref(false);
const deleting = ref(false);
const searchText = ref('');

// 對話框狀態
const showDialog = ref(false);
const showDeleteConfirm = ref(false);
const isEditing = ref(false);
const currentEmployee = ref<Employee>({} as Employee);
const employeeToDelete = ref<Employee | null>(null);

// 同步狀態
const isOnline = ref(navigator.onLine);
const isSyncing = ref(false);
const pendingChanges = ref(0);

// 選項
const genderOptions = [
  { label: '男', value: 'M' },
  { label: '女', value: 'F' }
];

const statusOptions = [
  { label: '在職', value: 'Active' },
  { label: '離職', value: 'Inactive' }
];

// 表格欄位定義
const columns = [
  
  { 
    name: 'FirstName', 
    label: '姓名', 
    field: (row: Employee) => `${row.FirstName} ${row.LastName}`, 
    sortable: true, 
    align: 'left' as const,
    style: 'width: 150px'
  },
  { 
    name: 'Department', 
    label: '部門', 
    field: 'Department', 
    sortable: true, 
    align: 'left' as const,
    style: 'width: 120px'
  },
  { 
    name: 'Position', 
    label: '職位', 
    field: 'Position', 
    sortable: true, 
    align: 'left' as const,
    style: 'width: 120px'
  },
  { 
    name: 'Email', 
    label: '電子郵件', 
    field: 'Email', 
    sortable: true, 
    align: 'left' as const,
    style: 'width: 200px'
  },
  { 
    name: 'Status', 
    label: '狀態', 
    field: 'Status', 
    sortable: true, 
    align: 'center' as const,
    style: 'width: 80px'
  },
  { 
    name: 'actions', 
    label: '操作', 
    field: '', 
    align: 'center' as const,
    style: 'width: 100px'
  },
];

// 計算屬性
const filteredEmployees = computed(() => {
  if (!searchText.value) return employees.value;
  
  const search = searchText.value.toLowerCase();
  return employees.value.filter(emp => 
    emp.FirstName.toLowerCase().includes(search) ||
    emp.LastName.toLowerCase().includes(search) ||
    emp.Department.toLowerCase().includes(search) ||
    emp.Position.toLowerCase().includes(search) ||
    emp.Email.toLowerCase().includes(search)
  );
});

// 移除未使用的 isMobile 以避免 linter 錯誤
const statusIcon = computed(() => {
  if (!isOnline.value) return 'cloud_off';
  if (isSyncing.value) return 'sync';
  if (pendingChanges.value > 0) return 'cloud_upload';
  return 'cloud_done';
});

const statusColor = computed(() => {
  if (!isOnline.value) return 'red';
  if (isSyncing.value) return 'blue';
  if (pendingChanges.value > 0) return 'orange';
  return 'dark'; // 已同步狀態使用黑色
});

const statusText = computed(() => {
  if (!isOnline.value) return '離線 未同步';
  if (isSyncing.value) return '同步中...';
  if (pendingChanges.value > 0) {
    return `有 ${pendingChanges.value} 項變更待同步`;
  }
  return '已同步';
});

const isFormValid = computed(() => {
  return !!(currentEmployee.value.FirstName && currentEmployee.value.LastName);
});

// 方法
const loadEmployees = async () => {
  loading.value = true;
  try {
    console.log('開始載入員工資料...');
    
    // 先嘗試從本地資料庫載入
    const localEmployees = await db.getAllEmployees();
    console.log('本地資料庫員工數量:', localEmployees.length);
    
    if (localEmployees.length === 0) {
      console.log('本地沒有資料，從 API 載入...');
      // 如果本地沒有資料，從 API 載入
      const apiEmployees = await db.fetchEmployeesFromAPI();
      // 清理數據以確保可以序列化
      employees.value = apiEmployees.map((emp: RawEmployeeData) => cleanEmployeeData(emp));
      console.log('從 API 載入的員工數量:', apiEmployees.length);
    } else {
      // 清理本地數據
      employees.value = localEmployees.map((emp: RawEmployeeData) => cleanEmployeeData(emp));
      console.log('使用本地資料，員工數量:', localEmployees.length);
    }
    
    await updateSyncStatus();
  } catch (error) {
    console.error('載入員工資料失敗:', error);
    notify('negative', '載入員工資料失敗');
  } finally {
    loading.value = false;
  }
};

// 清除特定員工的未同步變更記錄
const clearPendingChangesForEmployee = async (employeeId: number) => {
  try {
    const allChanges = await db.getUnsyncedChanges();
    
    // 修復：按多種條件匹配變更記錄
    const employeeChanges = allChanges.filter(change => {
      // 1. 直接匹配 EmployeeID
      if (change.employee.EmployeeID === employeeId) return true;
      
      // 2. 匹配臨時 ID (0 或負數)
      if (employeeId === 0 && change.employee.EmployeeID <= 0) return true;
      
      // 3. 匹配姓名和操作類型（用於離線新增後的情況）
      if (change.operation === 'create' && change.employee.EmployeeID <= 0) return true;
      
      return false;
    });
    
    if (employeeChanges.length > 0) {
      const changeIds = employeeChanges.map(c => c.id).filter(id => id !== undefined) as number[];
      await db.markChangesSynced(changeIds);
      console.log(`清除了 ${changeIds.length} 個員工 ${employeeId} 的變更記錄`);
    }
  } catch (error) {
    console.error('清除變更記錄失敗:', error);
  }
};

const updateSyncStatus = async () => {
  try {
    const status = await syncService.getSyncStatus();
    isOnline.value = status.isOnline;
    isSyncing.value = status.isSyncing;
    pendingChanges.value = status.unsyncedChangesCount;
  } catch (error) {
    console.error('更新同步狀態失敗:', error);
  }
};

// 已移除手動同步功能

// 調試功能：檢查變更記錄
// 已移除變更記錄除錯

       // 強制清理所有變更記錄
      // 已移除清除變更記錄

       // 調試：檢查 CRDT 文檔狀態
      // 已移除 CRDT 除錯

const handleRefresh = async () => {
  try {
    const apiEmployees = await db.fetchEmployeesFromAPI();
    // 清理數據以確保可以序列化
    employees.value = apiEmployees.map((emp: RawEmployeeData) => cleanEmployeeData(emp));
  await updateSyncStatus();
    notify('positive', '資料已重新載入');
  } catch (error) {
    console.error('重新載入失敗:', error);
    notify('negative', `重新載入失敗: ${error instanceof Error ? error.message : String(error)}`);
  }
};

// 已移除測試載入


function makeTempEmployeeId() {
  return -Date.now(); // 或改用 uuid()
}
const openAddDialog = () => {
  isEditing.value = false;
  currentEmployee.value = {
    EmployeeID: makeTempEmployeeId(), // 暫時 ID，避免與伺服器 ID 衝突
    FirstName: '',
    LastName: '',
    Department: '',
    Position: '',
    HireDate: '',
    BirthDate: '',
    Gender: '',
    Email: '',
    PhoneNumber: '',
    Address: '',
    Status: 'Active'
  };
  showDialog.value = true;
};

const editEmployee = (employee: Employee) => {
  isEditing.value = true;
  // 確保編輯時的數據是乾淨的，避免序列化問題
  currentEmployee.value = cleanEmployeeData(employee);
  showDialog.value = true;
};

const closeDialog = () => {
  showDialog.value = false;
  currentEmployee.value = {} as Employee;
};

const saveEmployee = async () => {
  if (!isFormValid.value) {
    notify('warning', '請填寫必填欄位');
    return;
  }

  saving.value = true;
  try {
    // 首先清理當前員工數據，確保沒有不可序列化的對象
    const cleanCurrentEmployee = cleanEmployeeData(currentEmployee.value);
    
    if (isEditing.value) {
      // ======= 更新員工（不直接打 REST）=======
      console.log('開始更新員工:', cleanCurrentEmployee);

      // 1) 寫入本地 + 記錄變更
      await db.updateEmployee(cleanCurrentEmployee);

      // 2) 立即更新畫面
      const idx = employees.value.findIndex(e => e.EmployeeID === cleanCurrentEmployee.EmployeeID);
      if (idx !== -1) employees.value[idx] = cleanCurrentEmployee;

      // 3) 在線就觸發同步（交給 syncService）
      if (navigator.onLine) {
        const ok = await syncService.manualSync();
        notify(ok ? 'positive' : 'warning', ok ? '同步完成' : '同步失敗，稍後再試');
      } else {
        notify('warning', '離線模式：資料已保存到本地，將在連線後自動同步');
      }
    } else {
  // ======= 新增員工（不直接打 REST；使用暫時 ID）=======
  console.log('開始新增員工:', cleanCurrentEmployee);

  // 若沒有合法的伺服器 ID，給一個暫時負數 ID（避免 0）
  if (!cleanCurrentEmployee.EmployeeID || cleanCurrentEmployee.EmployeeID <= 0) {
    cleanCurrentEmployee.EmployeeID = -Date.now(); // 或改成 uuid()
  }

  // 1) 寫入本地 + 記錄變更
  await db.addEmployee(cleanCurrentEmployee);

  // 2) 立即更新畫面
  employees.value.push(cleanCurrentEmployee);

  // 3) 在線就觸發同步（交給 syncService；伺服器會分配正式 ID）
  if (navigator.onLine) {
    const ok = await syncService.manualSync();
    notify(ok ? 'positive' : 'warning', ok ? '同步完成（將回填正式 ID）' : '同步失敗，稍後再試');
  } else {
    notify('warning', '離線模式：資料已保存到本地，將在連線後自動同步');
  }
}
    
    // 更新同步狀態
    await updateSyncStatus();
    closeDialog();
  } catch (error) {
    console.error('保存失敗:', error);
    notify('negative', `保存失敗: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    saving.value = false;
  }
};

const confirmDelete = (employee: Employee) => {
  employeeToDelete.value = employee;
  showDeleteConfirm.value = true;
};

const deleteEmployee = async () => {
  if (!employeeToDelete.value) return;
  
  deleting.value = true;
  try {
    console.log('開始刪除員工:', employeeToDelete.value.EmployeeID);
    
    
    // 先從本地資料庫刪除
    await db.deleteEmployee(employeeToDelete.value.EmployeeID);
    
    // 立即更新頁面顯示
    const index = employees.value.findIndex(emp => emp.EmployeeID === employeeToDelete.value!.EmployeeID);
    if (index !== -1) {
      employees.value.splice(index, 1);
    }
    // 在線：先呼叫後端 REST 刪除，以確保資料庫確實刪除；再進行 CRDT 同步
    if (isOnline.value) {
      try {
        const resp = await fetch(`${API_BASE}/employees/${employeeToDelete.value.EmployeeID}`, { method: 'DELETE' });
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        // 後端已刪除，進一步同步 CRDT 狀態
        const ok = await syncService.manualSync();
        if (ok) {
          await clearPendingChangesForEmployee(employeeToDelete.value.EmployeeID);
          notify('positive', '員工刪除成功並已同步');
        } else {
          notify('warning', '已刪除，但同步狀態待完成');
        }
      } catch (e) {
        console.warn('REST 刪除失敗，改由離線同步處理：', e);
        const ok = await syncService.manualSync();
        notify(ok ? 'positive' : 'warning', ok ? '刪除已同步' : '刪除變更尚未同步，稍後再試');
      }
    } else {
      notify('warning', '離線模式：資料已從本地刪除，將在連線後自動同步');
    }
    
    // 更新同步狀態
    await updateSyncStatus();
    
    showDeleteConfirm.value = false;
    employeeToDelete.value = null;
  } catch (error) {
    console.error('刪除失敗:', error);
    notify('negative', `刪除失敗: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    deleting.value = false;
  }
};

// 監聽網路狀態變化
watch(() => navigator.onLine, async (online) => {
  isOnline.value = online;
  if (online) {
    console.log('網路已連線，開始自動同步...');
    try {
      const success = await syncService.autoSync();
      if (success) {
        await loadEmployees();
        notify('positive', '自動同步完成');
      } else {
        notify('warning', '自動同步失敗，請手動同步');
      }
    } catch (error) {
      console.error('自動同步失敗:', error);
      notify('negative', '自動同步失敗');
    }
  } else {
    console.log('網路已離線');
    notify('warning', '網路已離線，資料將保存到本地');
  }
});

// 定期更新同步狀態
setInterval(() => void updateSyncStatus(), 10000);

// 初始化
onMounted(async () => {
  console.log('組件初始化，開始載入員工資料...');
  
  // 強制從 API 載入資料
  try {
    console.log('強制從 API 載入資料...');
    const apiEmployees = await db.fetchEmployeesFromAPI();
    // 清理數據以確保可以序列化
    employees.value = apiEmployees.map((emp: RawEmployeeData) => cleanEmployeeData(emp));
    console.log('從 API 載入的員工數量:', apiEmployees.length);
    await updateSyncStatus();
  } catch (error) {
    console.error('從 API 載入失敗，嘗試本地資料:', error);
  await loadEmployees();
  }
  
  // 啟動定期同步
  syncService.startPeriodicSync(30000);
});
</script>

<style scoped>
.employee-manager {
  height: 100vh;
  display: flex;
  flex-direction: column;
}

.status-bar {
  background: #f5f5f5;
  border-bottom: 1px solid #e0e0e0;
}

.main-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.action-bar {
  background: white;
  border-bottom: 1px solid #e0e0e0;
}

.table-container {
  flex: 1;
  overflow: auto;
}

.employee-table {
  height: 100%;
}

.search-input {
  max-width: 400px;
}

.add-btn {
  min-width: 120px;
}

/* 響應式設計 */
@media (max-width: 768px) {
  .action-bar .row {
    flex-direction: column;
    gap: 12px;
  }
  
  .action-bar .col {
    width: 100%;
  }
  
  .search-input {
    max-width: none;
  }
}
</style> 