const assert = require('node:assert/strict');

function adjustProductStock(products, productId, qty, type) {
  const prod = products.find(p => p.id === productId);
  if (!prod || !prod.track_inventory) return false;
  const amount = Number(qty) || 0;
  if (type === 'deduct') prod.stock = Math.max(0, prod.stock - amount);
  else prod.stock += amount;
  return true;
}

function getOrderItemKey(item) {
  return item.cartKey || `${item.id || item.productId || item.name}`;
}

function applyProductStockDeltaForOrder(products, order, newItems) {
  const previousItems = Array.isArray(order.stockAppliedItems) ? order.stockAppliedItems : [];
  const previousByKey = new Map(previousItems.map(item => [getOrderItemKey(item), item]));

  newItems.forEach(item => {
    const key = getOrderItemKey(item);
    const prev = previousByKey.get(key);
    const prevQty = prev ? Number(prev.quantity) || 0 : 0;
    const nextQty = Number(item.quantity) || 0;
    const diff = nextQty - prevQty;
    if (diff > 0) adjustProductStock(products, item.id || item.productId, diff, 'deduct');
    if (diff < 0) adjustProductStock(products, item.id || item.productId, Math.abs(diff), 'add');
    previousByKey.delete(key);
  });

  previousByKey.forEach(prev => {
    adjustProductStock(products, prev.id || prev.productId, Number(prev.quantity) || 0, 'add');
  });

  order.stockAppliedItems = newItems.map(item => ({
    id: item.id,
    productId: item.productId || item.id,
    cartKey: item.cartKey,
    name: item.name,
    quantity: Number(item.quantity) || 0
  }));
}

function reverseProductStockForOrder(products, order) {
  (order.stockAppliedItems || []).forEach(item => {
    adjustProductStock(products, item.id || item.productId, Number(item.quantity) || 0, 'add');
  });
  order.stockAppliedItems = [];
}

function adjustInventoryItemStock(inventory, itemId, qty, type) {
  const item = inventory.find(i => i.id === itemId);
  if (!item) return false;
  const amount = Number(qty) || 0;
  if (type === 'deduct') item.stock = Math.max(0, item.stock - amount);
  else item.stock += amount;
  return true;
}

function reverseExpenseInventoryLink(inventory, exp) {
  if (!exp || !exp.addedToInventory || !exp.productId || !exp.addQty) return;
  adjustInventoryItemStock(inventory, exp.productId, exp.addQty, 'deduct');
  exp.addedToInventory = false;
}

const products = [{ id: 'p1', name: 'Coke', stock: 10, track_inventory: true }];
const order = { id: 'ord-1' };
applyProductStockDeltaForOrder(products, order, [{ id: 'p1', name: 'Coke', quantity: 2 }]);
assert.equal(products[0].stock, 8);
applyProductStockDeltaForOrder(products, order, [{ id: 'p1', name: 'Coke', quantity: 5 }]);
assert.equal(products[0].stock, 5);
applyProductStockDeltaForOrder(products, order, [{ id: 'p1', name: 'Coke', quantity: 1 }]);
assert.equal(products[0].stock, 9);
reverseProductStockForOrder(products, order);
assert.equal(products[0].stock, 10);

const inventory = [{ id: 'inv-1', name: 'Eggs', stock: 20 }];
const exp = { id: 'exp-1', productId: 'inv-1', addQty: 12, addedToInventory: true };
adjustInventoryItemStock(inventory, exp.productId, exp.addQty, 'add');
assert.equal(inventory[0].stock, 32);
reverseExpenseInventoryLink(inventory, exp);
assert.equal(inventory[0].stock, 20);
reverseExpenseInventoryLink(inventory, exp);
assert.equal(inventory[0].stock, 20);

console.log('POS link smoke checks passed.');
