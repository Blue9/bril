#!/usr/bin/env node
import * as bril from './bril';
import {readStdin, unreachable} from './util';

const argCounts: {[key in bril.OpCode]: number | null} = {
  add: 2,
  mul: 2,
  sub: 2,
  div: 2,
  id: 1,
  lt: 2,
  le: 2,
  gt: 2,
  ge: 2,
  eq: 2,
  not: 1,
  and: 2,
  or: 2,
  print: null,  // Any number of arguments.
  br: 3,
  jmp: 1,
  ret: null,
  nop: 0,
  call: null,
};

type Value = boolean | BigInt;
type Env = Map<bril.Ident, Value>;
type FunctionMap = Map<bril.Ident, bril.Function>;
const returnVar = "_ret";

function get(env: Env, ident: bril.Ident) {
  let val = env.get(ident);
  if (typeof val === 'undefined') {
    throw `undefined variable ${ident}`;
  }
  return val;
}

/**
 * Ensure that the instruction has exactly `count` arguments,
 * throwing an exception otherwise.
 */
function checkArgs(instr: bril.Operation, count: number) {
  if (instr.args.length != count) {
    throw `${instr.op} takes ${count} argument(s); got ${instr.args.length}`;
  }
}

function getInt(instr: bril.Operation, env: Env, index: number) {
  let val = get(env, instr.args[index]);
  if (typeof val !== 'bigint') {
    throw `${instr.op} argument ${index} must be a number`;
  }
  return val;
}

function getBool(instr: bril.Operation, env: Env, index: number) {
  let val = get(env, instr.args[index]);
  if (typeof val !== 'boolean') {
    throw `${instr.op} argument ${index} must be a boolean`;
  }
  return val;
}

/**
 * The thing to do after interpreting an instruction: either transfer
 * control to a label, go to the next instruction, or end thefunction.
 */
type Action =
  {"label": bril.Ident} |
  {"next": true} |
  {"end": true};
let NEXT: Action = {"next": true};
let END: Action = {"end": true};

/**
 * Interpret an instruction in a given environment, possibly updating the
 * environment. If the instruction branches to a new label, return that label;
 * otherwise, return "next" to indicate that we should proceed to the next
 * instruction or "end" to terminate the function.
 */
function evalInstr(
  instr: bril.Instruction,
  env: Env,
  functionMap: FunctionMap,
  localMap: FunctionMap): Action {
  // Check that we have the right number of arguments.
  if (instr.op !== "const") {
    let count = argCounts[instr.op];
    if (count === undefined) {
      throw "unknown opcode " + instr.op;
    } else if (count !== null) {
      checkArgs(instr, count);
    }
  }

  switch (instr.op) {
  case "const":
    // Ensure that JSON ints get represented appropriately.
    let value: Value;
    if (typeof instr.value === "number") {
      value = BigInt(instr.value);
    } else {
      value = instr.value;
    }

    env.set(instr.dest, value);
    return NEXT;

  case "id": {
    let val = get(env, instr.args[0]);
    env.set(instr.dest, val);
    return NEXT;
  }

  case "add": {
    let val = getInt(instr, env, 0) + getInt(instr, env, 1);
    env.set(instr.dest, val);
    return NEXT;
  }

  case "mul": {
    let val = getInt(instr, env, 0) * getInt(instr, env, 1);
    env.set(instr.dest, val);
    return NEXT;
  }

  case "sub": {
    let val = getInt(instr, env, 0) - getInt(instr, env, 1);
    env.set(instr.dest, val);
    return NEXT;
  }

  case "div": {
    let val = getInt(instr, env, 0) / getInt(instr, env, 1);
    env.set(instr.dest, val);
    return NEXT;
  }

  case "le": {
    let val = getInt(instr, env, 0) <= getInt(instr, env, 1);
    env.set(instr.dest, val);
    return NEXT;
  }

  case "lt": {
    let val = getInt(instr, env, 0) < getInt(instr, env, 1);
    env.set(instr.dest, val);
    return NEXT;
  }

  case "gt": {
    let val = getInt(instr, env, 0) > getInt(instr, env, 1);
    env.set(instr.dest, val);
    return NEXT;
  }

  case "ge": {
    let val = getInt(instr, env, 0) >= getInt(instr, env, 1);
    env.set(instr.dest, val);
    return NEXT;
  }

  case "eq": {
    let val = getInt(instr, env, 0) === getInt(instr, env, 1);
    env.set(instr.dest, val);
    return NEXT;
  }

  case "not": {
    let val = !getBool(instr, env, 0);
    env.set(instr.dest, val);
    return NEXT;
  }

  case "and": {
    let val = getBool(instr, env, 0) && getBool(instr, env, 1);
    env.set(instr.dest, val);
    return NEXT;
  }

  case "or": {
    let val = getBool(instr, env, 0) || getBool(instr, env, 1);
    env.set(instr.dest, val);
    return NEXT;
  }

  case "print": {
    let values = instr.args.map(i => get(env, i).toString());
    console.log(...values);
    return NEXT;
  }

  case "jmp": {
    return {"label": instr.args[0]};
  }

  case "br": {
    let cond = getBool(instr, env, 0);
    if (cond) {
      return {"label": instr.args[1]};
    } else {
      return {"label": instr.args[2]};
    }
  }

  case "call": {
    let name = instr.args[0];
    if (functionMap.has(name) || localMap.has(name)) {
      let newEnv = new Map();
      let func = (localMap.has(name)) ? localMap.get(name) as
        bril.Function : functionMap.get(name) as bril.Function;
      let args = instr.args.slice(1);
      if (func.args === undefined && args.length > 0
        || args.length > 0 && func.args.length !== args.length) {
        throw `function ${name} expects ${func.args.length} arguments, ` +
        `got ${args.length}`;
      }
      for (let i = 0; i < args.length; i++) {
        newEnv.set(func.args[i].name, env.get(args[i]));
      }
      evalFunc(func, newEnv, functionMap);
      if (func.type !== undefined) {
        let returnVal = newEnv.get(returnVar);
        env.set(instr.dest, returnVal);
      } else if (instr.dest !== undefined) {
        throw `function ${func.name} does not return`;
      }
    } else {
      throw `function ${name} not found`;
    }
    return NEXT;
  }

  case "ret": {
    if (instr.args.length > 0) {
      let returnVal = env.get(instr.args[0]);
      env.set(returnVar, returnVal as any);
    }
    return END;
  }

  case "nop": {
    return NEXT;
  }
  }
  unreachable(instr);
  throw `unhandled opcode ${(instr as any).op}`;
}

function evalFunc(func: bril.Function, env: Env, functionMap: FunctionMap) {
  let localFunctionMap: FunctionMap = new Map();
  for (let i = 0; i < func.instrs.length; ++i) {
    let line = func.instrs[i];
    // Update local function map with functions in nested scope
    if ('name' in line) {
      localFunctionMap.set(line['name'], line);
    }
    if ('op' in line) {
      let action = evalInstr(line, env, functionMap, localFunctionMap);
      if ('label' in action) {
        // Search for the label and transfer control.
        for (i = 0; i < func.instrs.length; ++i) {
          let sLine = func.instrs[i];
          if ('label' in sLine && sLine.label === action.label) {
            break;
          }
        }
        if (i === func.instrs.length) {
          throw `label ${action.label} not found`;
        }
      } else if ('end' in action) {
        return;
      }
    }
  }
}

function evalProg(prog: bril.Program, cliArgs: (Number | Boolean)[]) {
  let functionMap = new Map();
  for (let func of prog.functions) {
    if (functionMap.has(func.name)) {
      throw `function names must be unique (${func.name})`;
    }
    functionMap.set(func.name, func);
  }
  if (functionMap.has("main")) {
    let mainFunc = functionMap.get("main") as bril.Function;
    if (mainFunc.args === undefined) {
        mainFunc.args = [];
    }
    if (mainFunc.args.length !== cliArgs.length) {
      throw `main function expected ${mainFunc.args.length} arguments, ` +
      `got ${cliArgs.length}`;
    }
    let env = new Map();
    for (let i = 0; i < cliArgs.length; i++) {
        env.set(mainFunc.args[i].name, cliArgs[i]);
    }
    evalFunc(functionMap.get("main"), env, functionMap);
  } else {
    throw `main function expected, none found. `
  }
}

function isNumeric(value: string) {
    return /^\d+$/.test(value);
}

async function main() {
  let prog = JSON.parse(await readStdin()) as bril.Program;
  // First two arguments of process.argv are node and brili binary paths.
  let rawArgs = process.argv.slice(2);
  let cliArgs = [] as (Number | Boolean)[];
  for (let arg of rawArgs) {
      if (isNumeric(arg)) {
          cliArgs.push(parseInt(arg));
      } else if (arg === "true" || arg === "false") {
          cliArgs.push(arg === "true");
      } else {
          throw `Argument ${arg} is not of type int or bool; exiting.`;
      }
  }
  evalProg(prog, cliArgs);
}

// Make unhandled promise rejections terminate.
process.on('unhandledRejection', e => { throw e });

main();
