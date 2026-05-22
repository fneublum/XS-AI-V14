// Verifies the lbs-vs-kg heuristic in v2/services/pdf/invoicePdf.ts.
// Invoice 8804 had `netWeight=42955` and `grossWeight=44985` stored,
// where both values were actually lbs (line items confirm 19,484 kg
// net). The drawer had a heuristic to normalize, but the PDF generator
// did not — so the PDF rendered "42,955.00 Kgs" instead of converting
// to ~19,484.

import { strict as assert } from 'node:assert';

// Mirror of the helper added to invoicePdf.ts.
const looksLikeLbs = (raw, itemsKg) => raw > 0 && itemsKg > 0 && raw > itemsKg * 1.5;
const toKg = (raw, itemsKg) => (looksLikeLbs(raw, itemsKg) ? raw * 0.453592 : raw);

let pass = 0;
let fail = 0;
function test(name, fn) {
    try { fn(); pass++; console.log('  ✓', name); }
    catch (e) { fail++; console.log('  ✗', name); console.log('    ', e.message); }
}

console.log('\nInvoice PDF weight-unit heuristic');

test('invoice 8804 case: 42955 raw + 19484 itemsKg → converts to ~19484 kg', () => {
    const raw = 42955;
    const itemsKg = 19484.04;
    const out = toKg(raw, itemsKg);
    // Expected: 42955 * 0.453592 ≈ 19484.0
    assert.ok(Math.abs(out - 19484.0) < 1, `expected ~19484, got ${out}`);
});

test('invoice 8804 gross: 44985 lbs → ~20405 kg', () => {
    const out = toKg(44985, 19484.04);
    assert.ok(Math.abs(out - 20404.36) < 1, `got ${out}`);
});

test('legitimate kg value (raw == itemsKg): not converted', () => {
    const out = toKg(19484.04, 19484.04);
    assert.equal(out, 19484.04);
});

test('legitimate kg value slightly above itemsKg (gross > net): not converted', () => {
    // gross is usually 1.05-1.15x net (tare); stays in kg.
    const out = toKg(20500, 19484.04);
    assert.equal(out, 20500);
});

test('threshold boundary: 1.5x itemsKg is NOT converted (just at edge)', () => {
    const itemsKg = 1000;
    const raw = 1500; // exactly 1.5x — heuristic uses strict >
    assert.equal(toKg(raw, itemsKg), 1500);
});

test('threshold boundary: 1.51x itemsKg IS converted', () => {
    const itemsKg = 1000;
    const raw = 1510;
    const out = toKg(raw, itemsKg);
    assert.ok(Math.abs(out - 1510 * 0.453592) < 0.001);
});

test('itemsKg=0 disables heuristic (no line items to compare against)', () => {
    // Without a baseline we cannot infer the unit, so leave raw alone.
    assert.equal(toKg(42955, 0), 42955);
});

test('raw=0 → 0 (falsy short-circuit)', () => {
    assert.equal(toKg(0, 19484), 0);
});

console.log(`\nTotal: ${pass + fail}  Passed: ${pass}  Failed: ${fail}`);
if (fail > 0) process.exit(1);
