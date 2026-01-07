# BusyTime Engine

## Installation

```bash
npm install @perdieminc/busytime
```

## Usage

```typescript
import Redis from 'ioredis';
import { Engine, TIMEFRAME_MODE } from '@perdieminc/busytime';

const redis = new Redis({
  host: 'localhost',
  port: 6379
});

const engine = new Engine({
  redis,
  bucket: 'storeId:locationId',
  timeframeMode: TIMEFRAME_MODE.BEFORE_ONLY
});

engine.setBusyTimeRule({
  timeFrame: 30,
  prepTime: 15,
  maxOrders: 10,
  maxItems: 100,
  totalPrice: 1000
});

await engine.validateOrder({
  orderId: '123',
  orderTime: new Date(),
  itemsCount: 5,
  totalPrice: 50
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

### `new Engine({ redis, bucket, timeframeMode?, logger? })`

Creates a new Engine instance.

- `redis`: Redis instance from ioredis
- `bucket`: Bucket identifier (e.g., `storeId:locationId`)
- `timeframeMode`: Optional timeframe calculation mode. Options:
  - `TIMEFRAME_MODE.BEFORE_ONLY` (default): Look back from order time
  - `TIMEFRAME_MODE.CENTERED`: Look both before and after order time (centered window)
  - `TIMEFRAME_MODE.AFTER_ONLY`: Look forward from order time
  - `TIMEFRAME_MODE.BEFORE_AND_AFTER`: Look both before and after order time (full window)
- `logger`: Optional logger instance (defaults to noop logger)

### `setBusyTimeRule(busyTimeRule)`

Defines the busy time rule for the bucket. The rule determines when to apply busy time based on order volume in a time window.

```typescript
engine.setBusyTimeRule({
  timeFrame: 30,      // Time window in minutes
  prepTime: 15,       // Busy time to apply in minutes
  maxOrders: 10,      // Optional: Max orders threshold
  maxItems: 100,      // Optional: Max items threshold
  totalPrice: 1000    // Optional: Max total price threshold
});
```

At least one threshold (`maxOrders`, `maxItems`, or `totalPrice`) must be set. When any threshold is exceeded within the time window, the busy time is applied.

### `validateOrder(order)`

Validates and processes an order. If thresholds are exceeded, a busy time period is created.

```typescript
await engine.validateOrder({
  orderId: '123',
  orderTime: new Date(),
  itemsCount: 5,
  totalPrice: 50.00
});
```

### `getBusyTimes()`

Returns an array of busy time entries:

```typescript
[
  {
    startTime: Date,     // Start of busy period
    endTime: Date,       // End of busy period
    busyTime: 15         // Duration in minutes
  }
]
```

### `getOrders()`

Returns an array of order entries:

```typescript
[
  {
    orderId: '123',
    orderTime: Date,
    itemsCount: 10,
    totalPrice: 100
  }
]
```

### `validateOrderTime(orderTime)`

Checks if an order placed at the given time would fall within a busy period. Returns wait period information:

```typescript
{
  waitPeriodSeconds: 420,  // Seconds to wait until busy period ends (0 if not busy)
  ordersInWindow: 0        // Currently unused
}
```

### `getOrdersStats(startTime, endTime)`

Retrieves order statistics for a specific time range. Returns an array of orders sorted by order time:

```typescript
[
  {
    orderId: '123',
    orderTime: Date,
    source: 'perdiem'  // Order source: 'perdiem' (ORDER_SOURCE.PERDIEM) or 'other' (ORDER_SOURCE.OTHER)
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
