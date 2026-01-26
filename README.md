# Order Pacing Engine

[![CI](https://github.com/PerDiemInc/order-pacing/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/PerDiemInc/order-pacing/actions/workflows/ci.yml)

## Installation

```bash
npm install @perdieminc/order-pacing
```

## Usage

```typescript
import Redis from 'ioredis';
import { Engine, TimeframeMode, OrderSource } from '@perdieminc/order-pacing';

const redis = new Redis({
  host: 'localhost',
  port: 6379
});

const engine = new Engine({
  redis,
  bucket: 'storeId:locationId',
  timeframeMode: TimeframeMode.BEFORE_ONLY,
  timeZone: 'UTC',
  rules: [{
    ruleId: 'rule-1',
    timeFrameMinutes: 30,
    busyTimeMinutes: 15,
    categoryIds: [],
    weekDays: [],
    maxOrders: 10,
    maxItems: 100,
    maxAmountCents: 100000
  }]
});

await engine.add({
  orderId: '123',
  orderTime: new Date(),
  totalAmountCents: 5000,
  source: OrderSource.PERDIEM,
  items: [{
    itemId: 'item-1',
    quantity: 2,
    totalAmountCents: 2000,
    categoryId: 'cat-1'
  }]
});

const busyTimes = await engine.getBusyTimes();
const orders = await engine.getOrders();
const validation = await engine.validateOrderTime(new Date());
const stats = await engine.getOrdersStats(
  new Date(Date.now() - 24 * 60 * 60 * 1000),
  new Date(Date.now() + 24 * 60 * 60 * 1000)
);
```

## API

### `new Engine({ redis, bucket, timeframeMode?, timeZone?, rules?, logger? })`

Creates a new Engine instance.

- `redis`: Redis instance from ioredis
- `bucket`: Bucket identifier (e.g., `storeId:locationId`)
- `timeframeMode`: Optional timeframe calculation mode. Options:
  - `TimeframeMode.BEFORE_ONLY` (default): Look back from order time
  - `TimeframeMode.CENTERED`: Look both before and after order time (centered window)
  - `TimeframeMode.AFTER_ONLY`: Look forward from order time
  - `TimeframeMode.BEFORE_AND_AFTER`: Look both before and after order time (full window)
- `timeZone`: Optional timezone string (defaults to `'UTC'`)
- `rules`: Optional array of rules (defaults to `[]`). Rules determine when to apply busy time based on order volume in a time window:
  ```typescript
  rules: [{
    ruleId: 'rule-1',              // Unique rule identifier
    timeFrameMinutes: 30,        // Time window in minutes
    busyTimeMinutes: 15,         // Busy time to apply in minutes
    categoryIds: [],      // Optional: Filter by category IDs (empty array = all categories)
    weekDays: [],         // Optional: Filter by week days 0-6 (empty array = all days)
    startTime: '09:00',   // Optional: Start time for rule (HH:mm format)
    endTime: '17:00',     // Optional: End time for rule (HH:mm format)
    maxOrders: 10,        // Optional: Max orders threshold
    maxItems: 100,        // Optional: Max items threshold
    maxAmountCents: 100000 // Optional: Max total amount in cents threshold
  }]
  ```
  At least one threshold (`maxOrders`, `maxItems`, or `maxAmountCents`) must be set. When any threshold is exceeded within the time window, the busy time is applied. Multiple rules can be set to handle different scenarios.
- `logger`: Optional logger instance (defaults to noop logger)

### `add(inputOrder)`

Adds an order to the engine. If thresholds are exceeded, a busy time period is created.

```typescript
await engine.add({
  orderId: '123',
  orderTime: new Date(),
  totalAmountCents: 5000, // Amount in cents ($50.00)
  source: OrderSource.PERDIEM, // or OrderSource.OTHER
  items: [{
    itemId: 'item-1',
    quantity: 2,
    totalAmountCents: 2000,
    categoryId: 'cat-1'
  }]
});
```

Note: Only orders with `source: OrderSource.PERDIEM` will trigger busy time calculations.

### `getBusyTimes()`

Returns an array of busy time entries:

```typescript
[
  {
    busyTimeId: string,           // Busy time unique identifier
    ruleId: string,               // Rule identifier that triggered this busy time
    startTime: Date,              // Start of busy period
    endTime: Date,                // End of busy period
    orderTimeSeconds: number,     // Order time in seconds
    currentTimeSeconds: number,   // Current time in seconds when busy time was created
    busyTimeSeconds: number,      // Duration in seconds
    busyTimeContext: {
      totalAmountCents: number,   // Total amount in cents from all orders in the time window
      totalItems: number,         // Total items from all orders in the time window
      totalOrders: number,        // Total number of orders in the time window
      categoryIds: string[]       // All category IDs from all orders in the time window
    },
    threshold: {
      type: 'orders' | 'items' | 'amount', // Type of threshold that was exceeded
      value: number,              // Actual value that exceeded the threshold
      limit: number,              // Threshold limit that was exceeded
      categoryIds: string[]       // Category IDs that were involved in the threshold
    }
  }
]
```

### `getOrders()`

Returns an array of order entries:

```typescript
[
  {
    orderId: '123',
    items: [{
      itemId: 'item-1',
      quantity: 2,
      totalAmountCents: 2000,
      categoryId: 'cat-1'
    }],
    totalAmountCents: 5000,
    source: OrderSource.PERDIEM, // or OrderSource.OTHER
    orderTime: Date,
    orderTimeSeconds: number,
    currentTimeSeconds: number
  }
]
```

### `validateOrderTime(orderTime)`

Checks if an order placed at the given time would fall within a busy period. Returns wait period information:

```typescript
{
  waitPeriodSeconds: number,  // Seconds to wait until busy period ends (0 if not busy)
  ordersInWindow: number      // Number of orders in the time window
}
```

### `getOrdersStats(startTime, endTime)`

Retrieves order statistics for a specific time range. Returns an array of orders sorted by order time:

```typescript
[
  {
    orderId: '123',
    orderTime: Date,
    source: OrderSource.PERDIEM // or OrderSource.OTHER
  }
]
```

Example:

```typescript
const stats = await engine.getOrdersStats(
  new Date(Date.now() - 24 * 60 * 60 * 1000),
  new Date(Date.now() + 24 * 60 * 60 * 1000)
);
```
