# StockPulse

> **Production-grade, offline-first Inventory, Purchase Order, and Statutory GST Billing Management System built in modern JavaScript (ES2024 / Node.js + Vanilla JS Frontend).**

---

## 1. Project Motivation & Problem Statement

Modern enterprise supply chains and manufacturing businesses frequently suffer from internet volatility, vendor lock-in, and expensive cloud dependencies. Small-to-medium manufacturing and trading firms operating warehouses, retail counters, or remote distribution yards require a mission-critical billing and stock control system that:

1. **Functions 100% Offline with Zero Cloud Reliance:** Stores transactions durably on local hardware with write-ahead logging (WAL), crash recovery, and automated snapshot rotation.
2. **Implements Accurate Stock Valuation:** Strict multi-lot batch tracking supporting both **FIFO** (First-In, First-Out) and **LIFO** (Last-In, First-Out) stock depletion with exact Cost of Goods Sold (COGS) attribution and negative-stock prevention.
3. **Statutory GST Billing Compliance:** Dynamic tax calculations supporting Indian Goods and Services Tax (GST) rules — automatically detecting intra-state (equal CGST + SGST split) vs. inter-state (IGST) transactions across statutory tax slabs (0%, 5%, 12%, 18%, 28%), trade discount deductions, fractional rupee round-off, sequential invoice numbering (`INV-YYYY-XXXXX`), and credit note inventory reversals (`CN-YYYY-XXXXX`).
4. **End-to-End Procurement Lifecycle:** Purchase orders governed by an enforced finite state machine (`DRAFT` → `ISSUED` → `PARTIALLY_RECEIVED` → `FULFILLED`), partial shipment intake math, vendor lead-time moving averages, and 4-tier accounts payable aging analysis.

---

## 2. System Architecture

### Architectural Overview (Mermaid)

```mermaid
graph TD
    Client[Vanilla JS Single-Page Application] -->|HTTP / JSON| ExpressApp[Express.js App Router]
    CLI[Companion CLI bin/stockpulse-cli.js] -->|Direct Invocation| DomainLayer

    subgraph MiddlewareLayer [Express Middleware]
        RequestLogger[Structured Request Logger & Correlation ID]
        RateLimiter[Sliding-Window Memory Rate Limiter]
        PayloadValidator[Request Body & Schema Validator]
        ErrorHandler[Centralized RFC 7807 Error Handler]
    end

    ExpressApp --> MiddlewareLayer
    MiddlewareLayer --> Controllers[API Controllers]

    subgraph DomainLayer [Core Domain Engines]
        Controllers --> InventoryEngine[Inventory Engine: FIFO/LIFO, ROP, Dead Stock]
        Controllers --> BillingEngine[Billing & GST Engine: Slabs, Invoicing, Credit Notes]
        Controllers --> SupplierManager[Supplier Manager: PO State Machine, AP Aging]
        Controllers --> AnalyticsService[Analytics: Turnover, DSI, Gross Margin, CSV]
    end

    subgraph StorageLayer [Embedded Transactional Storage Engine]
        InventoryEngine --> DataStore[Transactional DataStore]
        BillingEngine --> DataStore
        SupplierManager --> DataStore
        AnalyticsService --> DataStore

        DataStore --> WAL[Write-Ahead Log: Append-only, SHA-256 Checksum]
        DataStore --> IndexManager[Secondary Index Manager: O(1) Unique/Non-Unique]
        DataStore --> BackupManager[Automated Snapshot Backups & Retention Rotation]
        DataStore --> DiskSnapshots[(Runtime JSON Snapshots)]
    end
```

### ASCII Architecture

```text
+---------------------------------------------------------------------------------+
|                         STOCKPULSE CLIENT INTERFACES                            |
|    +----------------------------------+    +-------------------------------+    |
|    |    Vanilla JS Responsive SPA     |    |   Companion Node.js CLI Tool  |    |
|    |  (Web Components, State, Router) |    |   (bin/stockpulse-cli.js)     |    |
+----+-----------------+----------------+----+---------------+---------------+----+
                       |                                     |
                       v                                     v
+---------------------------------------------------------------------------------+
|                           EXPRESS API & MIDDLEWARE                              |
|   - Request Logger (Correlation IDs)  - Sliding-Window Rate Limiter             |
|   - Payload Schema Validator          - Centralized Error Handler               |
+---------------------------------------------------------------------------------+
                                       |
                                       v
+---------------------------------------------------------------------------------+
|                              CORE DOMAIN ENGINES                                |
|  +--------------------+  +--------------------+  +---------------------------+  |
|  |  Inventory Engine  |  |   Billing Engine   |  |     Supplier Manager      |  |
|  | - FIFO/LIFO Deplete|  | - GST Tax Slabs    |  | - PO State Machine        |  |
|  | - COGS Calculation |  | - Intra vs Inter   |  | - Partial Fulfillment     |  |
|  | - ROP Thresholds   |  | - Credit Notes     |  | - Accounts Payable Aging  |  |
|  +--------------------+  +--------------------+  +---------------------------+  |
|  +---------------------------------------------------------------------------+  |
|  |                          Analytics Service                                |  |
|  |  - Inventory Turnover Ratio  - Days Sales of Inventory (DSI)              |  |
|  |  - Gross Margin & Profit     - RFC 4180 CSV Data Exporter                 |  |
|  +---------------------------------------------------------------------------+  |
+---------------------------------------------------------------------------------+
                                       |
                                       v
+---------------------------------------------------------------------------------+
|                     TRANSACTIONAL STORAGE ENGINE (EMBEDDED)                     |
|  +--------------------+  +--------------------+  +---------------------------+  |
|  |  Write-Ahead Log   |  |   Secondary Index  |  |    Backup Snapshots       |  |
|  |  (SHA-256 Checksum)|  |   (Unique & Non)   |  |    (Retention Rotation)   |  |
|  +--------------------+  +--------------------+  +---------------------------+  |
|  +---------------------------------------------------------------------------+  |
|  | Memory Document Collections + AsyncLocalStorage Re-entrant Write Queue    |  |
|  +---------------------------------------------------------------------------+  |
+---------------------------------------------------------------------------------+
```

---

## 3. Directory Structure

```text
.
├── .env.example                       # Safe environment template (zero secrets)
├── .gitignore                          # Ignores runtime data, secrets, node_modules
├── LICENSE                             # MIT License (Sole copyright holder: Kshitij Himanshu)
├── README.md                           # Comprehensive documentation and API manual
├── package.json                        # Node.js ES module configuration & scripts
├── bin/
│   └── stockpulse-cli.js               # Executable companion CLI toolkit
├── src/
│   ├── app.js                          # Express application factory
│   ├── server.js                       # HTTP server bootstrap & graceful shutdown
│   ├── config/
│   │   ├── constants.js                # Tax slabs, PO states, collections
│   │   └── env.js                      # Environment configuration parser
│   ├── core/
│   │   ├── analyticsService.js         # Turnover, DSI, KPI aggregation, CSV export
│   │   ├── billingEngine.js            # GST calculation, invoice numbering, credit notes
│   │   ├── errors.js                   # Structured domain error hierarchy
│   │   ├── inventoryEngine.js          # FIFO/LIFO stock valuation, ROP, dead stock
│   │   └── supplierManager.js          # Vendor profiles, PO lifecycle, AP aging
│   ├── controllers/
│   │   ├── analyticsController.js      # Analytics REST handlers
│   │   ├── billingController.js        # Billing & quote REST handlers
│   │   ├── inventoryController.js      # SKU & batch REST handlers
│   │   └── supplierController.js       # Supplier & PO REST handlers
│   ├── middleware/
│   │   ├── errorHandler.js             # RFC 7807 structured error handler
│   │   ├── rateLimiter.js              # In-memory sliding-window rate limiter
│   │   ├── requestLogger.js            # Request correlation ID & timing logger
│   │   └── validator.js                # Request body validation middleware
│   ├── routes/
│   │   ├── analyticsRoutes.js          # Express router for /api/v1/analytics
│   │   ├── apiRouter.js                # Unified API router & /health endpoint
│   │   ├── billingRoutes.js            # Express router for /api/v1/billing
│   │   ├── inventoryRoutes.js          # Express router for /api/v1/inventory
│   │   └── supplierRoutes.js           # Express router for /api/v1/suppliers
│   └── storage/
│       ├── backupManager.js            # Snapshot creation and retention rotation
│       ├── dataStore.js                # Core transactional storage engine
│       ├── indexManager.js             # Secondary B-Tree / Map indexing
│       ├── schemaValidator.js          # Entity schema validation rules
│       └── wal.js                      # Write-Ahead Log with crash recovery
├── public/
│   ├── index.html                      # Semantic SPA HTML shell
│   ├── css/
│   │   └── style.css                   # Custom responsive CSS design system
│   └── js/
│       ├── apiClient.js                # Typed HTTP client wrapper
│       ├── app.js                      # SPA bootstrap entrypoint
│       ├── router.js                   # Client-side hash router
│       ├── state.js                    # Reactive pub/sub state manager
│       ├── components/
│       │   ├── analyticsDashboard.js   # KPI cards, turnover, revenue timeline
│       │   ├── inventoryView.js        # SKU catalog, lots inspector, ROP alerts
│       │   ├── invoiceBuilder.js       # GST invoice generator & credit notes
│       │   ├── navbar.js               # Top header with offline status badge
│       │   ├── supplierView.js         # Vendor directory & PO state machine
│       │   └── toast.js                # Animated notification alerts
│       └── utils/
│           ├── dom.js                  # Accessible modal dialog & DOM utilities
│           └── formatters.js           # INR currency, date, and status formatters
└── tests/
    ├── integration/
    │   └── api.test.js                 # REST endpoints, workflows, concurrency tests
    └── unit/
        ├── analyticsService.test.js    # KPIs, turnover, DSI, CSV tests
        ├── billingEngine.test.js       # GST slabs, rounding, credit notes tests
        ├── inventoryEngine.test.js     # FIFO vs LIFO, ROP, dead stock tests
        ├── storageEngine.test.js       # WAL recovery, atomic TX, backups tests
        └── supplierManager.test.js     # PO state machine, AP aging tests
```

---

## 4. Prerequisites & Installation

### Prerequisites
- **Node.js**: `v20.0.0` or later (tested on Node v26.9.0)
- **Git**
- **Zero External Database or Cloud Services Required**: Runs completely offline out of the box.

### Installation

```bash
# Clone the repository
git clone https://github.com/kshitij7320/Business_Demo_App.git
cd Business_Demo_App

# Install dependencies (Express.js)
npm install
```

### Environment Configuration

Copy the sample environment file:

```bash
cp .env.example .env
```

Default settings in `.env.example`:

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` | HTTP port for web application and REST API |
| `STORAGE_DIR` | `./data` | Directory where snapshots and WAL logs reside |
| `BACKUP_RETENTION_COUNT` | `5` | Number of historical snapshot backups to retain |
| `COMPANY_NAME` | `StockPulse Enterprises` | Legal business entity name |
| `COMPANY_GSTIN` | `27AAAAA0000A1Z5` | 15-character Indian GST identification number |
| `COMPANY_STATE_CODE` | `27` | 2-digit Indian GST State Code (e.g., 27 for Maharashtra) |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limiter window in milliseconds |
| `RATE_LIMIT_MAX` | `120` | Maximum requests per IP window |

---

## 5. Running the Application

### Start Development Server
```bash
npm run dev
```

### Start Production Server
```bash
npm start
```

Access the application in your browser:
- **Web UI**: [http://localhost:3000](http://localhost:3000)
- **API Base**: [http://localhost:3000/api/v1](http://localhost:3000/api/v1)
- **Health Check**: [http://localhost:3000/api/v1/health](http://localhost:3000/api/v1/health)

---

## 6. Using the Companion CLI Utility

The project includes an executable CLI utility at `bin/stockpulse-cli.js`.

### CLI Commands

```bash
# Display CLI help manual
node bin/stockpulse-cli.js --help

# Batch import inventory from CSV
node bin/stockpulse-cli.js import-inventory sample-inventory.csv

# Export current inventory catalogue to CSV
node bin/stockpulse-cli.js export-inventory exported_stock.csv

# Run real-time low-stock reorder point diagnostics
node bin/stockpulse-cli.js low-stock

# Perform ledger reconciliation between batch lots and stock transactions
node bin/stockpulse-cli.js reconcile
```

### Sample CSV Import Format

Create a file named `sample-inventory.csv`:

```csv
skuCode,name,category,unit,sellingPrice,taxRate,quantity,unitCostPrice,reorderPoint
BOLT-TITANIUM,Titanium M8 Bolt,Hardware,PCS,120,18,100,75,20
CABLE-CAT6A,Cat6A Shielded Cable 100m,Cables,BOX,2400,18,30,1650,10
VALVE-SOLENOID,Solenoid Valve 24V,Pneumatics,PCS,1850,18,15,1200,5
```

Run import:
```bash
node bin/stockpulse-cli.js import-inventory sample-inventory.csv
```

---

## 7. Running the Test Suite

StockPulse relies on Node.js's native test runner (`node:test` and `node:assert/strict`) — providing lightning-fast execution with zero third-party testing dependencies.

```bash
# Run all unit and integration tests (37 tests across 6 test suites)
npm test

# Run unit tests only
npm run test:unit

# Run integration tests only
npm run test:integration
```

All 37 genuine tests verify:
- FIFO vs. LIFO multi-lot stock deduction math, weighted average unit costs, and COGS calculations.
- Strict negative-stock prevention throwing `InsufficientStockError` without altering inventory state.
- Intra-state (equal CGST + SGST split) and inter-state (IGST) tax calculations across all GST slabs (0%, 5%, 12%, 18%, 28%).
- Fractional currency round-off adjustments and credit note reversals with inventory restoration.
- Purchase Order state transitions (`DRAFT` → `ISSUED` → `PARTIALLY_RECEIVED` → `FULFILLED`) and shipment intake.
- Write-Ahead Log crash recovery and checksum verification.
- Concurrency write safety preventing race conditions during simultaneous multi-client checkouts.

---

## 8. REST API Endpoint Reference

All API routes are prefixed with `/api/v1` (or `/api`).

### Health Check

#### `GET /api/v1/health`
Checks server and storage engine operational status.

**Response `200 OK`**:
```json
{
  "status": "UP",
  "timestamp": "2026-10-15T12:00:00.000Z",
  "uptimeSeconds": 142,
  "system": "StockPulse Offline Engine"
}
```

---

### Inventory Endpoints

#### `GET /api/v1/inventory/skus`
Returns all registered SKUs with current stock levels.

#### `POST /api/v1/inventory/skus`
Registers a new SKU in the master catalogue.

**Request Body**:
```json
{
  "skuCode": "ELEC-WIDGET-01",
  "name": "Precision Electronic Sensor",
  "category": "Electronics",
  "unit": "PCS",
  "hsnCode": "8542",
  "sellingPrice": 450.00,
  "taxRate": 18,
  "reorderPoint": 20,
  "safetyStock": 5
}
```

#### `POST /api/v1/inventory/skus/:id/receive`
Deposits a new stock lot batch for the SKU.

**Request Body**:
```json
{
  "quantity": 50,
  "unitCostPrice": 280.00,
  "batchNumber": "LOT-2026-A1",
  "expiryDate": "2027-12-31"
}
```

#### `GET /api/v1/inventory/alerts/reorder`
Identifies all SKUs whose stock is at or below the dynamic Reorder Point (ROP).

---

### Billing & GST Endpoints

#### `POST /api/v1/billing/quote`
Previews statutory GST tax calculations without modifying inventory.

#### `POST /api/v1/billing/invoices`
Generates a tax invoice, depletes inventory via FIFO or LIFO, calculates COGS, and records profit.

**Request Body**:
```json
{
  "customerName": "Acme Manufacturing Ltd",
  "customerGstin": "27AABCA1234A1Z1",
  "customerStateCode": "27",
  "valuationMethod": "FIFO",
  "items": [
    {
      "skuId": "3b29c9df-2879-4d64-89d8-79c2980ecb4e",
      "quantity": 10,
      "unitPrice": 450.00,
      "discountPercent": 5
    }
  ]
}
```

**Response `201 Created`**:
```json
{
  "data": {
    "id": "a90df214-e580-4966-9b1f-e8b345f190a2",
    "invoiceNumber": "INV-2026-00001",
    "customerName": "Acme Manufacturing Ltd",
    "customerStateCode": "27",
    "isIntraState": true,
    "taxableAmount": 4275.00,
    "cgstAmount": 384.75,
    "sgstAmount": 384.75,
    "igstAmount": 0.00,
    "totalAmount": 5045.00,
    "totalCogs": 2800.00,
    "grossProfit": 1475.00,
    "status": "PAID"
  }
}
```

#### `POST /api/v1/billing/credit-notes`
Issues a statutory credit note, reverses GST, and restores returned stock to inventory.

---

### Supplier & Procurement Endpoints

#### `POST /api/v1/suppliers`
Registers a new supplier profile.

#### `POST /api/v1/suppliers/purchase-orders`
Creates a Purchase Order in `DRAFT` status.

#### `PATCH /api/v1/suppliers/purchase-orders/:id/status`
Advances the PO lifecycle state (`DRAFT` → `ISSUED` → `CANCELLED`).

#### `POST /api/v1/suppliers/purchase-orders/:id/receive`
Records shipment arrival, updates line item received quantities, deposits batch lots into inventory, and marks PO as `PARTIALLY_RECEIVED` or `FULFILLED`.

#### `GET /api/v1/suppliers/reports/payable-aging`
Generates accounts payable aging report across Current (0-30d), 31-60d, 61-90d, and Over 90d overdue brackets.

---

### Analytics Endpoints

#### `GET /api/v1/analytics/dashboard`
Returns high-level KPIs (Total Inventory Value, Total Revenue, COGS, Gross Profit Margin %, Low Stock Count) and Inventory Turnover Ratio / Days Sales of Inventory (DSI).

#### `GET /api/v1/analytics/export/inventory.csv`
Downloads an RFC 4180 compliant CSV stream of all inventory stock levels.

---

## 9. License

This project is licensed under the **MIT License**.
Copyright (c) 2026 **Kshitij Himanshu**. See [LICENSE](LICENSE) for full details.
