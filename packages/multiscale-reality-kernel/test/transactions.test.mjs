import assert from 'node:assert/strict';
import { createTransactionJournal } from '../src/index.js';

let tick = 7;
const journal = createTransactionJournal({
  types: ['TRANSFER', 'REFINE'],
  historyLimit: 4,
  getTick: () => tick,
});

const order = [];
journal.register('TRANSFER', event => {
  order.push('low');
  event.result.amount += 1;
}, 1);
journal.register('TRANSFER', event => {
  order.push('high');
  event.result.amount *= 2;
}, 10);

const event = journal.transact('TRANSFER', { from: 'coarse', to: 'fine' }, { amount: 3 });
assert.deepEqual(order, ['high', 'low']);
assert.equal(event.result.amount, 7);
assert.equal(event.tick, 7);

const hooks = [];
journal.beforeStep(context => hooks.push(`before:${context.dt}`), 1);
journal.afterStep(context => hooks.push(`after:${context.dt}`), 1);
journal.runBeforeStep({ dt: 0.5 });
journal.runAfterStep({ dt: 0.5 });
assert.deepEqual(hooks, ['before:0.5', 'after:0.5']);

tick = 8;
journal.transact('REFINE', { nodeId: 'planet' });
const snapshot = journal.snapshot();
assert.equal(snapshot.counts.TRANSFER, 1);
assert.equal(snapshot.counts.REFINE, 1);
assert.deepEqual(snapshot.recent.map(record => record.sequence), [1, 2]);
assert.deepEqual(snapshot.recent.map(record => record.tick), [7, 8]);
assert.throws(() => journal.transact('UNKNOWN'), /Unknown transaction type/);

journal.destroy();
assert.throws(() => journal.transact('TRANSFER'), /destroyed/);

console.log(JSON.stringify({ ok: true, deterministicHandlerOrder: order, hooks, counts: snapshot.counts }, null, 2));
