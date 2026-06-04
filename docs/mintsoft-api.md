# Mintsoft API — Working Reference

Base URL: `https://api.mintsoft.co.uk`
Auth header on every call: `ms-apikey: <key>` (keys last 24h; renew via `POST /api/Auth`).

The full swagger spec lives at `docs/mintsoft-api-swagger.json` (drop the raw export there).
This file is the **curated, verified** subset we actually use — kept because Mintsoft's
parameter naming/casing is inconsistent and has repeatedly caused 400/404s.

> ⚠️ **Gotcha:** ASP.NET routes like `/api/Product/<anything>?id=X` will happily return
> generic product detail for almost any action name, so a `200` does **not** confirm you
> hit the right endpoint. Always check the response *shape*, not just the status.

---

## Auth
- `POST /api/Auth` — body `{ "UserName": "...", "Password": "..." }` → returns API key string.

## Orders
- `GET /api/Order/List` — paginated order headers (includes courier + parcel counts, no line items).
  - `WarehouseId` (int), `ClientId` (int, optional)
  - `SinceOrderDate` (`yyyy-MM-ddT00:00:00`) — filter by order created date; captures **all** statuses.
  - `SinceDespatchDate` (`yyyy-MM-ddT00:00:00`) — filter by despatch date; only despatched orders.
  - `ToDate`, `Limit` (max 100), `PageNo`
  - Useful header fields: `ID`, `ClientId`, `OrderStatusId`, `CourierServiceName`,
    `NumberOfParcels`, `DespatchDate`, `OrderDate`, `WarehouseId`.
- `GET /api/Order/{id}` — single order **with** `OrderItems` (each: `ProductId`, `SKU`, `Quantity`).
  Works regardless of order status.
- `GET /api/Order/Costs?id={orderId}` — customer-facing order detail (shipping/value), **not** 3PL billing.

## Products & Stock
- `GET /api/Product/List?WarehouseId={id}` — product catalogue, paginated (`PageNo`, `Limit`).
- `GET /api/Product/StockLevels?WarehouseId={id}` — **correct** stock endpoint (NOT `StockLevelsByWarehouse`).
  - Returns all items in one call. Per-item: `ProductId`, `WarehouseId`, `ClientId`, `SKU`,
    `Level` (qty on hand — NOT `QtyOnHand`), `TotalStockLevel`, `Breakdown` (often null).

## Accounting / Invoices
- `GET /api/Accounting/Invoice/List?ClientId={id}` — confirmed monthly invoices (past months).
  - Per-invoice cost fields: `PickingCost`, `PostageCost`, `VatFreePostageCost`, `StorageCost`,
    `GoodsInCost`, `ReturnsCost`, `ReworkCost`, `PackagingCost`, `GenericInvoiceItemsCost`,
    `CollectionsCost`, `AdminFee`, `NumberOfParcels`, `NumberOfItems`, `Date`, `ID`.
- `GET /api/Account/Invoice/GetUnconfirmedInvoiceSummary` — current/in-progress month accruals.
  - ⚠️ Params are **`clientID`** (capital ID), **`fromDate`**, **`toDate`** (`yyyy-MM-dd`). All required.
  - Returns one summary object with the same cost fields as a confirmed invoice (`ID` will be 0).
- `GET /api/Account/Invoice/GetUnconfirmedInvoiceStorageCosts` — same params + `pageNo`/`limit`;
  returns per-day storage line items (`InvoiceDate`, `Type`, `Cost`, `WarehouseId`, `ClientId`).

## ASN (Advanced Shipping Notice / goods-in)
- `GET /api/ASN/List?WarehouseId={id}` — `ASNStatusId` (e.g. `1;2;4`), `ClientId`, `SinceLastUpdated`,
  `BookedInStartInterval`/`BookedInEndInterval`, `IncludeASNItems` (bool), `PageNo`, `Limit`.
- `GET /api/ASN/{id}` — single ASN with items. `PUT /api/ASN` create, `POST /api/ASN/{id}` update.

## Batches & Picking
- `POST /api/Batch` — create a batch from a list of OrderIDs (`NewBatch` body).
- `GET /api/Batch/{id}?includeOrderItems=true` — batch orders (+ items).
- `GET /api/Batch/List` — `CreatedSince`, `PickingComplete`, `Tote`.
- `POST /api/Batch/AssignBatchToUser` — `BatchID`, `AssignToUser`, `PickingType`.
- `POST /api/Batch/DespatchBatch` — despatch a fully-picked batch.

## Product locations (for pick lists)
- `GET /api/Reports/ProductsInLocationReport` — physical stock-in-location data per SKU,
  **regardless of order allocation** (this is how we bypass Mintsoft's awaiting-replen
  pick-list block). Params: `warehouseId`, `clientId`, `locationTypeId`, `showOrderAllocations`,
  `excludeQuarantine` (bool — pass `true`), `pageNo`, `limit`, `sinceUpdated`.
  - Row fields: `Client`, `Warehouse`, `Location` (bin name e.g. "1A1A", or "UNASSIGNED"),
    `Type` (`Allocation` | `Quarantine` | `Allocation_OffHand`), `LocationType`
    (`PICK` | `BULK` | `STORE` | `PALLET` | `GOODS IN` | `UNASSIGNED`), `AllocatedOrder`,
    `ProductSKU`, `ProductName`, `Quantity` (string), `BatchNo`, `BestBefore`, `ProductInLocationId`.
  - For picking: filter out `Location === 'UNASSIGNED'` and prefer `LocationType === 'PICK'`.
- `GET /api/Order/{id}/Allocations` — locations already allocated to an order
  (`ProductInLocation[]`: `LocationId`, `ProductId`, `Quantity`, `OrderItemId`). Empty for
  unallocated orders (e.g. awaiting-replen) — which is exactly why we use the report above instead.
- `GET /api/Warehouse/{WarehouseId}/Location/All` — all bin locations in a warehouse.

## Replenishment points
- `GET /api/ReplenPoints` — per-SKU replen config. Params: `ProductId`, `SKU`,
  `LocationTypeId`, `PageNo`, `Limit`.
  - Row fields: `ProductId`, `ProductSKU`, `ProductName`, `LocationTypeName` (e.g. `PICK`),
    `Size` (target capacity to refill the face up to), `ReplenPoint` (threshold to trigger replen).
  - ⚠️ **ReplenPoint and Size are per SKU (per location type), NOT per bin.** Two SKUs sharing
    the same pick bin each have their own values — key the lookup by SKU.
  - Used by the Replen List: compare each PICK face's qty (from ProductsInLocationReport) to the
    SKU's ReplenPoint; if ≤, replen `Size − qty` from a BULK/STORE/PALLET location holding that SKU.
- `POST /api/ReplenPoint` · `PUT /api/ReplenPoint/{id}` — add/update replen points.

## Reference data
- `GET /api/Warehouse` · `GET /api/Client` · `GET /api/Order/Statuses` · `GET /api/ASN/Statuses`

---

## Courier categorisation (used by End-of-Day Despatch report)
`CourierServiceName` → carrier:
- **Royal Mail**: name starts `RM ` or contains `royal mail` (e.g. "RM Tracked 48").
- **APC**: name starts `APC` (e.g. "APC Next Day").
- **FedEx**: name contains `fedex` (e.g. "Fedex Oversize").
Royal Mail is ~1 parcel/order; APC & FedEx frequently split orders across multiple parcels.
