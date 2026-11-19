import assert from "node:assert/strict";
import test from "node:test";
import { evaluateExpression } from "./calc.js";

test("四则与优先级", () => {
  assert.equal(evaluateExpression("1+2*3").value, 7);
  assert.equal(evaluateExpression("(1+2)*3").value, 9);
  assert.equal(evaluateExpression("10/4").value, 2.5);
  assert.equal(evaluateExpression("2^10").value, 1024);
  assert.equal(evaluateExpression("10%3").value, 1);
  assert.equal(evaluateExpression("-5+3").value, -2);
  assert.equal(evaluateExpression("2^-2").value, 0.25);
});

test("函数与常量", () => {
  assert.equal(evaluateExpression("sqrt(16)").value, 4);
  assert.equal(evaluateExpression("max(1, 5, 3)").value, 5);
  assert.equal(evaluateExpression("min(2, -1)").value, -1);
  assert.ok(Math.abs(evaluateExpression("sin(0)").value) < 1e-12);
  assert.ok(Math.abs(evaluateExpression("cos(pi)").value + 1) < 1e-12);
  assert.ok(Math.abs(evaluateExpression("ln(e^2)").value - 2) < 1e-10);
  assert.equal(evaluateExpression("pow(2, 8)").value, 256);
});

test("中文标点容错", () => {
  assert.equal(evaluateExpression("3×4").value, 12);
  assert.equal(evaluateExpression("8÷2").value, 4);
  assert.equal(evaluateExpression("round(3.6，0)").value, 4);
});

test("格式化输出", () => {
  assert.ok(evaluateExpression("120*0.85").pretty.includes("102"));
  assert.equal(evaluateExpression("1e3").value, 1000);
});

test("安全防护", () => {
  assert.throws(() => evaluateExpression(""));
  assert.throws(() => evaluateExpression("1/0"), /除以零/);
  assert.throws(() => evaluateExpression("process.exit(1)"));
  assert.throws(() => evaluateExpression("1+2 3"), /多余/);
  assert.throws(() => evaluateExpression("foo(1)"), /不支持的函数/);
  assert.throws(() => evaluateExpression("(1+2"), /右括号/);
  assert.throws(() => evaluateExpression(".".repeat(600)), /过长/);
  let deep = "";
  for (let i = 0; i < 70; i++) deep += "(";
  deep += "1";
  for (let i = 0; i < 70; i++) deep += ")";
  assert.throws(() => evaluateExpression(deep), /嵌套过深|右括号/);
});
