/**
 * 计算器求值内核（R65）：零依赖安全表达式求值。
 *
 * 模型工具 calculator 的后端。不用 eval/new Function（不可信输入），
 * 手写递归下降解析器：
 *   表达式 ::= 加减项 (('+'|'-') 加减项)*
 *   加减项 ::= 乘除模 (('*'|'/'|'%') 乘除模)*
 *   乘除模 ::= 幂 (('^') 幂)*            （右结合）
 *   幂     ::= 一元
 *   一元   ::= ('-'|'+') 一元 | 原子
 *   原子   ::= 数字 | '(' 表达式 ')' | 函数 '(' 参数表 ')' | 常量
 * 函数：sqrt/sin/cos/tan/ln/log/log2/abs/round/floor/ceil/exp/pow/min/max
 * 常量：pi/e。长度上限 512 字符，深度上限 64，数值 NaN/Infinity 报错。
 */
export function evaluateExpression(input: string): { value: number; pretty: string } {
  const src = input.trim().replace(/[，]/g, ",").replace(/[（]/g, "(").replace(/[）]/g, ")").replace(/[×]/g, "*").replace(/[÷]/g, "/").replace(/[−–—]/g, "-");
  if (!src) throw new Error("表达式为空");
  if (src.length > 512) throw new Error("表达式过长（上限 512 字符）");
  let pos = 0;
  let depth = 0;

  const peek = (): string => src[pos] ?? "";
  const eat = (): string => src[pos++] ?? "";
  const skip = (): void => { while (/\s/.test(peek())) pos++; };

  function parseExpr(): number {
    let left = parseTerm();
    for (;;) {
      skip();
      const op = peek();
      if (op !== "+" && op !== "-") return left;
      eat();
      const right = parseTerm();
      left = op === "+" ? left + right : left - right;
    }
  }
  function parseTerm(): number {
    let left = parsePower();
    for (;;) {
      skip();
      const op = peek();
      if (op !== "*" && op !== "/" && op !== "%") return left;
      eat();
      const right = parsePower();
      if (op === "*" || op === "/") {
        if (op === "/" && right === 0) throw new Error("除以零");
        left = op === "*" ? left * right : left / right;
      } else {
        if (right === 0) throw new Error("对零取模");
        left = left % right;
      }
    }
  }
  function parsePower(): number {
    const base = parseUnary();
    skip();
    if (peek() === "^") { eat(); const exp = parsePower(); return Math.pow(base, exp); }
    return base;
  }
  function parseUnary(): number {
    skip();
    if (peek() === "-") { eat(); return -parseUnary(); }
    if (peek() === "+") { eat(); return parseUnary(); }
    return parseAtom();
  }
  function parseAtom(): number {
    skip();
    if (depth > 64) throw new Error("表达式嵌套过深");
    const ch = peek();
    if (ch === "(") { eat(); depth += 1; const value = parseExpr(); skip(); if (eat() !== ")") throw new Error("缺少右括号"); depth -= 1; return value; }
    const number = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|^\.\d+/.exec(src.slice(pos));
    if (number) { pos += number[0].length; const value = Number(number[0]); if (!Number.isFinite(value)) throw new Error(`数字超出范围：${number[0]}`); return value; }
    const name = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(src.slice(pos));
    if (name) {
      pos += name[0].length;
      const lower = name[0].toLowerCase();
      const constants: Record<string, number> = { pi: Math.PI, e: Math.E };
      if (lower in constants) return constants[lower];
      skip();
      if (eat() !== "(") throw new Error(`未知符号：${name[0]}`);
      depth += 1;
      const args: number[] = [];
      skip();
      if (peek() !== ")") { args.push(parseExpr()); skip(); while (peek() === ",") { eat(); args.push(parseExpr()); skip(); } }
      if (eat() !== ")") throw new Error(`函数 ${lower} 缺少右括号`);
      depth -= 1;
      const apply = FUNCS[lower];
      if (!apply) throw new Error(`不支持的函数：${lower}`);
      return apply(...args);
    }
    throw new Error(`无法解析的字符：${ch || "（表达式意外结束）"}`);
  }

  const FUNCS: Record<string, (...values: number[]) => number> = {
    sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan,
    ln: Math.log, log: Math.log10, log2: Math.log2,
    abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil, exp: Math.exp,
    pow: Math.pow, min: Math.min, max: Math.max
  };

  const value = parseExpr();
  skip();
  if (pos < src.length) throw new Error(`表达式末尾有多余内容：${src.slice(pos)}`);
  if (!Number.isFinite(value)) throw new Error("计算结果不是有限数字");
  return { value, pretty: formatNumber(value) };
}

function formatNumber(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return value.toLocaleString("zh-CN");
  const fixed = value.toFixed(10).replace(/0+$/, "").replace(/\.$/, "");
  return fixed;
}
