export interface Employee {
  EmployeeID: number;
  FirstName: string;
  LastName: string;
  Department: string;
  Position: string;
  HireDate: string;
  BirthDate: string;
  Gender: string;
  Email: string;
  PhoneNumber: string;
  Address: string;
  Status: string;
}

export interface EmployeeChange {
  id?: number; // Dexie auto-increment primary key (optional for new records)
  employee: Employee;
  timestamp: number;
  operation: 'create' | 'update' | 'delete';
  synced: boolean;
}

export interface SyncState {
  id?: number;
  lastSyncTimestamp: number;
  pendingChanges: EmployeeChange[];
  isOnline: boolean;
  isSyncing: boolean;
} 