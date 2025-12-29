# PrepTime Engine

A TypeScript library for managing order prep times using Redis sorted sets.

## Installation

```bash
npm install preptime-engine
```

## Usage

```typescript
import Redis from 'ioredis';
import { PrepTimeEngine, TIMEFRAME_CALCULATION_MODE } from 'preptime-engine';

const redis = new Redis({
  host: 'localhost',
  port: 6379
});

const bucket = 'storeId:locationId';
const engine = new PrepTimeEngine(bucket, redis);

engine.setRule(30, 10, 100, 1000, 15);

await engine.processOrderPrepTime(new Date(), 5, 50);

const preptimes = await engine.getPrepTimes();
const orders = await engine.getOrders();
const validation = await engine.validateOrderTime(new Date());
```

## API

### `new PrepTimeEngine(bucket, redis, timeframeMode?)`

Creates a new PrepTimeEngine instance.

- `bucket`: Format `storeId:locationId`
- `redis`: Redis instance from ioredis
- `timeframeMode`: Optional timeframe calculation mode (`TIMEFRAME_CALCULATION_MODE.BEFORE_ONLY` or `TIMEFRAME_CALCULATION_MODE.CENTERED`)

### `setRule(timeFrame, maxOrders, maxItems, totalPrice, prepTime)`

Defines the rule for the bucket. Rule is based on `maxOrders`, `maxItems`, `totalPrice` in `timeFrame` to set the `prepTime`.

### `processOrderPrepTime(orderTime, itemsCount, totalPrice)`

Processes the order and sets the prepTime based on the defined rules.

### `getPrepTimes()`

Returns prep times in the following format:

```json
{
  "preptimes": [
    {
      "startTime": "2025-01-01 12:00:00",
      "endTime": "2025-01-01 12:15:00",
      "prepTime": 15
    }
  ]
}
```

### `getOrders()`

Returns orders in the following format:

```json
{
  "orders": [
    {
      "orderTime": "2025-01-01 12:00:00",
      "itemsCount": 10,
      "totalPrice": 100
    }
  ]
}
```

### `validateOrderTime(orderTime)`

Validates if an order can be placed at the given time. Returns:

```json
{
  "orderInTime": 7,
  "ordersInWindow": 10
}
```

## License

MIT

