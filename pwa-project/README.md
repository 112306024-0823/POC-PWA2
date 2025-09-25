# PWA 員工管理系統 (CRDT + 離線支援)

這是一個支援離線操作和自動資料同步的漸進式 Web 應用程式 (PWA)，使用 CRDT (Conflict-Free Replicated Data Type) 技術確保多設備間的資料一致性。

## 功能特色

### 🌐 PWA 功能
- ✅ 可安裝到桌面和手機主屏幕
- ✅ 離線使用支援
- ✅ 自動快取和更新
- ✅ 響應式設計

### 📡 離線支援
- ✅ 離線時可繼續操作（新增、編輯、刪除員工）
- ✅ 本地資料儲存 (IndexedDB)
- ✅ 網路恢復時自動同步
- ✅ 同步狀態即時顯示

### 🔄 CRDT 資料同步
- ✅ 使用 Automerge 解決資料衝突
- ✅ 多設備間無衝突合併
- ✅ 自動和手動同步模式
- ✅ 變更追蹤和歷史記錄

### 👥 員工管理
- ✅ 完整的 CRUD 操作
- ✅ 即時搜尋和篩選
- ✅ 表單驗證

## 技術架構

### 前端
- **Vue 3** - 漸進式 JavaScript 框架
- **Quasar Framework** - Vue.js 的 UI 框架，提供 PWA 支援
- **TypeScript** - 類型安全
- **Automerge** - CRDT 資料同步
- **Dexie** - IndexedDB 包裝器
- **Workbox** - PWA 功能和快取策略

### 後端
- **Node.js + Express** - REST API 服務器
- **SQL Server** - 主資料庫
- **Automerge** - 後端 CRDT 處理
- **CORS** - 跨域請求支援

## 安裝和啟動

### 前置要求
- Node.js 18+ 
- SQL Server
- npm 或 yarn

### 1. 前端設置

```bash
# 在根目錄

# 安裝依賴
npm install

# 啟動開發服務器
npm run dev

# 建置生產版本
npm run build
```
pwa模式啟動：npx quasar dev -m pwa

### 2. 後端設置

```bash
# 進入後端目錄
cd pwa-project/backend

# 安裝依賴
npm install

# 設定資料庫連接（編輯 server.js 中的 dbConfig）
# 請更新以下資訊：
# - user: 您的 SQL Server 使用者名稱
# - password: 您的 SQL Server 密碼
# - server: SQL Server 主機位址
# - database: 資料庫名稱

# 啟動後端服務器
npm run dev
```

### 3. 資料庫設置

確保您的 SQL Server 中有以下資料表結構：

```sql
CREATE TABLE Employee (
    EmployeeID NVARCHAR(50) PRIMARY KEY,
    FirstName NVARCHAR(50),
    LastName NVARCHAR(50),
    Department NVARCHAR(100),
    Position NVARCHAR(100),
    HireDate DATE,
    BirthDate DATE,
    Gender NVARCHAR(10),
    Email NVARCHAR(100),
    PhoneNumber NVARCHAR(20),
    Address NVARCHAR(255),
    Status NVARCHAR(20)
);
```

## 使用指南

### 基本操作

1. **新增員工**
   - 點擊「新增員工」按鈕
   - 填寫員工資訊
   - 點擊「保存」

2. **編輯員工**
   - 點擊員工列表中的編輯圖示
   - 修改資訊後點擊「保存」

3. **刪除員工**
   - 點擊員工列表中的刪除圖示
   - 確認刪除操作

4. **搜尋員工**
   - 在搜尋欄輸入關鍵字
   - 系統會即時篩選結果

### 離線使用

1. **離線操作**
   - 斷開網路連接
   - 繼續進行員工管理操作
   - 所有變更會儲存在本地

2. **查看同步狀態**
   - 頂部橫幅顯示目前連線狀態
   - 綠色：已同步
   - 橙色：有待同步的變更
   - 紅色：離線模式
   - 藍色：同步中

3. **手動同步**
   - 點擊同步狀態欄的「同步」按鈕
   - 網路恢復後會自動嘗試同步

### PWA 安裝

1. **桌面安裝**
   - 在 Chrome 瀏覽器中打開應用
   - 點擊網址列右側的安裝圖示
   - 確認安裝

2. **手機安裝**
   - 在手機瀏覽器中打開應用
   - 點擊「加到主屏幕」
   - 確認安裝

## API 文檔

### REST API 端點

```
GET    /api/health              # 健康檢查
GET    /api/employees           # 獲取所有員工
POST   /api/employees           # 新增員工
PUT    /api/employees/:id       # 更新員工
DELETE /api/employees/:id       # 刪除員工
```

### CRDT 同步端點

```
GET    /api/sync/document       # 獲取 CRDT 文檔
POST   /api/sync/document       # 合併 CRDT 文檔
```

## 開發指南

### 本地開發

1. 確保後端服務器在 `http://localhost:3001` 運行
2. 前端開發服務器在 `http://localhost:9000` 運行
3. 修改 `src/services/sync.ts` 中的 `apiBaseUrl` 以指向正確的後端位址

### 部署到生產環境

1. **前端部署**
   ```bash
   npm run build
   # 將 dist/pwa 目錄部署到您的 Web 服務器
   ```

2. **後端部署**
   - 設定正確的資料庫連接
   - 設定環境變數
   - 使用 PM2 或類似工具管理 Node.js 進程

### 自定義配置

- **PWA 設定**: 編輯 `quasar.config.ts` 中的 `pwa` 區段
- **同步間隔**: 修改 `sync.ts` 中的同步間隔時間
- **快取策略**: 調整 Workbox 設定

## 故障排除

### 常見問題

1. **同步失敗**
   - 檢查網路連接
   - 確認後端服務器運行狀態
   - 查看瀏覽器開發者工具的 Console 錯誤

2. **PWA 安裝問題**
   - 確保使用 HTTPS 或 localhost
   - 檢查 Service Worker 註冊狀態
   - 清除瀏覽器快取

3. **資料庫連接問題**
   - 確認 SQL Server 連接設定
   - 檢查防火牆設定
   - 驗證資料庫權限

### 日誌查看

- **前端**: 瀏覽器開發者工具 Console
- **後端**: 服務器 console 輸出
- **資料庫**: SQL Server 錯誤日誌

## 授權

MIT License

## 貢獻

歡迎提交 Issue 和 Pull Request 來改善這個專案。

## 聯絡

如有問題或建議，請聯絡專案維護人員。
