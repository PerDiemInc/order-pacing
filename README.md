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
    tags: ['delivery'],
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
  tags: ['delivery'],
  items: [{
    itemId: 'item-1',
    quantity: 2,
    totalAmountCents: 2000,
    categoryId: 'cat-1'
  }]
});

const busyTimes = await engine.getBusyTimes();
const orders = await engine.getOrders();
const validation = await engine.validateOrderTime({ orderTime: new Date(), tags: ['delivery'] });
const stats = await engine.getOrdersStats(
  new Date(Date.now() - 24 * 60 * 60 * 1000),
  new Date(Date.now() + 24 * 60 * 60 * 1000)
);
```

## API

### `new Engine({ redis, bucket, timeframeMode?, busyTimeMode?, timeZone?, rules?, logger? })`

Creates a new Engine instance.

- `redis`: Redis instance from ioredis
- `bucket`: Bucket identifier (e.g., `storeId:locationId`)
- `timeframeMode`: Optional timeframe calculation mode. Options:
  - `TimeframeMode.BEFORE_ONLY` (default): Look back `timeFrameMinutes` from order time
  - `TimeframeMode.CENTERED`: Half of `timeFrameMinutes` on each side of order time (~`timeFrameMinutes` total)
  - `TimeframeMode.AFTER_ONLY`: Look forward `timeFrameMinutes` from order time
  - `TimeframeMode.BEFORE_AND_AFTER`: `timeFrameMinutes` on each side of order time (~2x `timeFrameMinutes` total)
- `busyTimeMode`: Optional. Where a tripped rule's busy period sits around the order that tripped it, with the same options:
  - `TimeframeMode.BEFORE_ONLY` (default): the `busyTimeMinutes` before the order
  - `TimeframeMode.AFTER_ONLY`: the `busyTimeMinutes` after it
  - `TimeframeMode.CENTERED`: half of `busyTimeMinutes` on each side
  - `TimeframeMode.BEFORE_AND_AFTER`: `busyTimeMinutes` on each side, so an order ready a few minutes after a booked one waits too, not just one ready a few minutes before it

  Whatever the mode, the period never ends before `busyTimeMinutes` from now. It stops a second short of `busyTimeMinutes` from the order, so the time exactly `busyTimeMinutes` before or after a booked order (the next slot on a 5-minute grid with a 5-minute busy time) stays free.
- `timeZone`: Optional IANA timezone name, e.g. `'America/New_York'` (defaults to `'UTC'`). Used only to evaluate rule `weekDays`/`startTime`/`endTime` against the order time; all timestamps are stored as UTC epoch seconds.
- `rules`: Optional array of rules (defaults to `[]`). Rules determine when to apply busy time based on order volume in a time window:
  ```typescript
  rules: [{
    ruleId: 'rule-1',              // Unique rule identifier
    timeFrameMinutes: 30,        // Time window in minutes
    busyTimeMinutes: 15,         // Busy time to apply in minutes (minimum 5)
    categoryIds: [],      // Optional: Filter by category IDs (omitted or empty = all categories)
    weekDays: [],         // Optional: Filter by week days 0-6, 0 = Sunday (omitted or empty = all days)
    startTime: '09:00',   // Optional: Start time for rule (HH:mm or HH:mm:ss, seconds are ignored)
    endTime: '17:00',     // Optional: End time for rule (HH:mm or HH:mm:ss, seconds are ignored)
    tags: ['delivery'],   // Optional: Filter by order tags (omitted or empty = all orders)
    maxOrders: 10,        // Optional: Max orders threshold
    maxItems: 100,        // Optional: Max items threshold
    maxAmountCents: 100000 // Optional: Max total amount in cents threshold
  }]
  ```
  At least one threshold (`maxOrders`, `maxItems`, or `maxAmountCents`) must be set. When any threshold is reached (`>=`) within the time window — the order being added counts toward its own window — the busy time is applied. Multiple rules can be set to handle different scenarios; each matching rule creates its own busy time. The constructor throws if any rule is invalid, naming the offending rule.

  A rule scoped by `tags` only counts matching orders toward its thresholds, only trips on matching orders, and its busy times only delay matching orders — a `['delivery']` cap never blocks pickups. An order matches when it carries every rule tag; tag vocabulary is the consumer's to define (e.g. `pickup`, `delivery`, `catering`). A rule tag can also be a list of tags, which an order matches by carrying any one of them: `tags: [['delivery', 'curbside'], 'catering']` counts and delays catering orders that are delivery or curbside, together under one limit. All rule filters combine with AND.
- `logger`: Optional logger instance (defaults to a noop logger; a `consoleLogger` is also exported)

### `add(inputOrder)`

Adds an order to the engine. If a rule's threshold is reached, a busy time period is created around the order's scheduled time as `busyTimeMode` places it (by default the `busyTimeMinutes` before it), ending no earlier than `busyTimeMinutes` from now. Throws a `TypeError` if `orderTime` is not a valid `Date`, `orderId` is empty, or `tags` is not an array of non-empty strings.

```typescript
await engine.add({
  orderId: '123',
  orderTime: new Date(),
  totalAmountCents: 5000, // Amount in cents ($50.00)
  source: OrderSource.PERDIEM, // or OrderSource.OTHER
  tags: ['pickup'],
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
    scope: RuleTag[],             // The tripping rule's tags; only matching orders are delayed ([] = all)
    busyTimeContext: {
      totalAmountCents: number,   // Total amount in cents from all orders in the time window
      totalItems: number,         // Total items from all orders in the time window
      totalOrders: number,        // Total number of orders in the time window
      categoryIds: string[]       // All category IDs from all orders in the time window
    },
    threshold: {
      type: 'orders' | 'items' | 'amount', // Type of threshold that was reached
      value: number,              // Actual value that reached the threshold
      limit: number,              // Threshold limit that was reached
      categoryIds: string[]       // The rule's configured categoryIds filter (empty if unfiltered)
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

### `validateOrderTime({ orderTime, tags?, categoryIds? })`

Checks if an order placed at the given time would fall within a busy period that applies to its tags (`tags` defaults to `[]`). Only busy periods whose scope matches are considered — a `['delivery']`-scoped busy period never delays a pickup order. Pass the categories of the order's items as `categoryIds` and a busy period from a rule limited to categories (`threshold.categoryIds`) only delays orders holding one of them; without `categoryIds`, every busy period counts whatever its categories. Consecutive matching busy periods chain: if pushing the order past one period lands it inside the next, the wait extends until the first free moment. Already-ended busy periods are ignored. Throws a `TypeError` if `orderTime` is not a valid `Date`, or `tags` or `categoryIds` is not an array of non-empty strings. Returns wait period information:

```typescript
const validation = await engine.validateOrderTime({ orderTime: new Date(), tags: ['delivery'], categoryIds: ['cat-1'] });

{
  waitPeriodSeconds: number,  // Seconds to wait until one second past the last delaying busy period (0 if not busy)
  ordersInWindow: number      // totalOrders recorded by the busy period that delayed the order (0 if not busy)
}
```

### `getOrdersStats(startTime, endTime)`

Retrieves order statistics for a specific time range. Note that orders are only retained for 7 days (see Data retention below), so older ranges return partial or no data. Returns an array of orders sorted by order time:

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

## Data retention

- Orders are kept for **7 days** past their order time; busy times for **1 day** past their triggering order's time.
- Pruning happens lazily on engine calls (`add()` and the read methods) — there is no TTL on the Redis keys, so buckets that stop receiving traffic keep their last entries until the next call.
- `validateOrderTime()` ignores busy periods that have already ended, so lingering expired entries do not affect results.

## Redis requirements

- `ioredis` (v5) is a peer dependency; the engine uses an injected client and never opens its own connection.
- Each bucket uses two sorted sets: `orders:{bucket}` and `busytimes:{bucket}`.
- Every method, including the `get*` reads, may prune expired entries, so the engine needs a writable Redis connection.
