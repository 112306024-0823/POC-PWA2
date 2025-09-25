import Dexie, { type Table } from 'dexie';
import type { Employee, EmployeeChange, SyncState } from '../types/employee';

export class EmployeeDatabase extends Dexie {
  //先創三個本地的表，分別是員工表、變更表、同步狀態表
  employees!: Table<Employee>;
  changes!: Table<EmployeeChange>;
  syncState!: Table<SyncState>;

  constructor() {
    super('EmployeeDatabase');
    this.version(1).stores({
      employees: '++id,EmployeeID, FirstName, LastName, Department, Position, Email',
      changes: '++id, EmployeeID, timestamp, operation, synced',
      syncState: '++id, lastSyncTimestamp'
    });

    // v2: 將 employees 的主鍵改為 EmployeeID，避免重複與更新失敗
    this.version(2)
      .stores({
        // 使用 EmployeeID 作為主鍵
        employees: 'EmployeeID, FirstName, LastName, Department, Position, Email',
        changes: '++id, EmployeeID, timestamp, operation, synced',
        syncState: '++id, lastSyncTimestamp'
      })
      .upgrade(async (tx) => {
        const oldTable = tx.table('employees');
        const all = await oldTable.toArray();
        // 轉換：確保 EmployeeID 是 number 並唯一
        const migrated = all
          .map((e: unknown) => {
            const emp = e as Record<string, unknown>;
            return {
            EmployeeID: Number(emp?.EmployeeID ?? 0),
            FirstName: String(emp?.FirstName ?? ''),
            LastName: String(emp?.LastName ?? ''),
            Department: String(emp?.Department ?? ''),
            Position: String(emp?.Position ?? ''),
            HireDate: String(emp?.HireDate ?? ''),
            BirthDate: String(emp?.BirthDate ?? ''),
            Gender: String(emp?.Gender ?? ''),
            Email: String(emp?.Email ?? ''),
            PhoneNumber: String(emp?.PhoneNumber ?? ''),
            Address: String(emp?.Address ?? ''),
            Status: String(emp?.Status ?? 'Active'),
          };
        })
          // 過濾掉沒有合法 EmployeeID 的紀錄（<=0 的視為暫時資料，交由同步後重建）
          .filter((e) => Number.isInteger(e.EmployeeID) && e.EmployeeID > 0);

        if (migrated.length) {
          await tx.table('employees').clear();
          await tx.table('employees').bulkPut(migrated);
        }
      });
  }

  // 新增員工
  async addEmployee(employee: Employee): Promise<void> {
    await this.transaction('rw', this.employees, this.changes, async () => {
      await this.employees.put(employee);
      await this.changes.add({
        employee,
        timestamp: Date.now(),
        operation: 'create',
        synced: false
      });
    });
  }

  // 更新員工
  async updateEmployee(employee: Employee): Promise<void> {
    await this.transaction('rw', this.employees, this.changes, async () => {
      await this.employees.put(employee);
      await this.changes.add({
        employee,
        timestamp: Date.now(),
        operation: 'update',
        synced: false
      });
    });
  }

  // 刪除員工
  async deleteEmployee(employeeId: number): Promise<void> {
    const employee = await this.employees.where('EmployeeID').equals(employeeId).first();
    if (employee) {
      await this.transaction('rw', this.employees, this.changes, async () => {
        await this.employees.where('EmployeeID').equals(employeeId).delete();
        await this.changes.add({
          employee,
          timestamp: Date.now(),
          operation: 'delete',
          synced: false
        });
      });
    } else {
      // Tombstone: 即使本地沒有該員工，也記錄刪除意圖，確保回線後可同步
      const tombstone: Employee = {
        EmployeeID: Number(employeeId),
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
        Status: 'Deleted'
      };
      await this.changes.add({
        employee: tombstone,
        timestamp: Date.now(),
        operation: 'delete',
        synced: false
      });
    }
  }

  // 獲取所有員工
  async getAllEmployees(): Promise<Employee[]> {
    return await this.employees.toArray();
  }

  // 獲取未同步的變更
  async getUnsyncedChanges(): Promise<EmployeeChange[]> {
    return await this.changes.filter(change => change.synced === false).toArray();
  }

  // 標記變更為已同步
  async markChangesSynced(changeIds: number[]): Promise<void> {
    await this.changes.where('id').anyOf(changeIds).modify({ synced: true });
  }

  // 清除所有未同步的變更記錄（用於重置）
  async clearAllUnsyncedChanges(): Promise<void> {
    await this.changes.filter(change => change.synced === false).delete();
  }

  // 根據員工資料清除變更記錄（用於離線新增後）
  async clearChangesByEmployeeData(employeeData: Partial<Employee>): Promise<void> {
    const changes = await this.changes.filter(change => change.synced === false).toArray();
    
    const matchingChanges = changes.filter(change => {
      const emp = change.employee;
      return (
        emp.FirstName === employeeData.FirstName &&
        emp.LastName === employeeData.LastName &&
        emp.Email === employeeData.Email &&
        change.operation === 'create'
      );
    });
    
    if (matchingChanges.length > 0) {
      const changeIds = matchingChanges.map(c => c.id).filter(id => id !== undefined) as number[];
      await this.markChangesSynced(changeIds);
      console.log(`根據員工資料清除了 ${changeIds.length} 個變更記錄`);
    }
  }

  // 清除已同步的變更（保留最近的記錄）
  async cleanupSyncedChanges(): Promise<void> {
    const cutoffTime = Date.now() - (7 * 24 * 60 * 60 * 1000); // 保留7天
    await this.changes.filter(change => 
      change.synced === true && change.timestamp < cutoffTime
    ).delete();
  }

  // 獲取同步狀態
  async getSyncState(): Promise<SyncState | undefined> {
    return await this.syncState.orderBy('id').last();
  }

  // 更新同步狀態
  async updateSyncState(state: Partial<SyncState>): Promise<void> {
    const currentState = await this.getSyncState();
    if (currentState) {
      await this.syncState.update(currentState.id!, state);
    } else {
      await this.syncState.add({
        lastSyncTimestamp: 0,
        pendingChanges: [],
        isOnline: navigator.onLine,
        isSyncing: false,
        ...state
      } as SyncState);
    }
  }
  
  private normalizeEmployee(raw: unknown): Employee {
    const toDate = (d: unknown): string => {
      if (d == null) return '';
      const dt = new Date(String(d));
      return Number.isNaN(dt.getTime())
        ? ''
        : `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    };

    const obj = (typeof raw === 'object' && raw !== null) ? (raw as Record<string, unknown>) : {};

    return {
      EmployeeID: Number(obj.EmployeeID ?? 0),
      FirstName: String(obj.FirstName ?? ''),
      LastName: String(obj.LastName ?? ''),
      Department: String(obj.Department ?? ''),
      Position: String(obj.Position ?? ''),
      HireDate: toDate(obj.HireDate),
      BirthDate: toDate(obj.BirthDate),
      Gender: String(obj.Gender ?? ''),
      Email: String(obj.Email ?? ''),
      PhoneNumber: String(obj.PhoneNumber ?? ''),
      Address: String(obj.Address ?? ''),
      Status: String(obj.Status ?? 'Active')
    };
  }
  // 直接從 API 獲取員工數據（測試用）
  async fetchEmployeesFromAPI(): Promise<Employee[]> {
    const rawBase = import.meta.env?.VITE_API_BASE || 'http://localhost:3001/api';
    const normalizedBase = rawBase.endsWith('/api')
      ? rawBase
      : `${String(rawBase).replace(/\/+$/, '')}/api`;
    const response = await fetch(`${normalizedBase}/employees`);
    if (!response.ok) {
      throw new Error(`API 請求失敗: ${response.status} ${response.statusText}`);
    }
    const json = await response.json() as unknown;
    const arr = Array.isArray(json) ? json : [];
    const normalized = arr.map((r) => this.normalizeEmployee(r));
    await this.employees.clear();
    await this.employees.bulkPut(normalized);
    return normalized; // 回傳已正規化的資料
  }
  }

export const db = new EmployeeDatabase(); 