"""A text format for Bril.

This module defines both a parser and a pretty-printer for a
human-editable representation of Bril programs. There are two commands:
`bril2txt`, which takes a Bril program in its (canonical) JSON format and
pretty-prints it in the text format, and `bril2json`, which parses the
format and emits the ordinary JSON representation.
"""

import lark
import sys
import json

__version__ = '0.0.1'


# Text format parser.

GRAMMAR = """
start: imp* func*

imp: "import" CNAME ";"
func: CNAME arg* "{" instr* "}" | CNAME arg* ":" type "{" instr* "}"
def_func: "def" func

?instr: def_func | const | vop | eop | label 

const.4: IDENT ":" type "=" "const" lit ";"
vop.3: IDENT ":" type "=" CNAME IDENT* ";"
eop.2: CNAME IDENT* ";"
label.1: IDENT ":"

lit: SIGNED_INT  -> int
  | BOOL     -> bool

type: CNAME
arg: IDENT | "(" IDENT ":" type ")"
BOOL: "true" | "false"
IDENT: ("_"|"%"|LETTER) ("_"|"%"|"."|LETTER|DIGIT)*
COMMENT: /#.*/

%import common.SIGNED_INT
%import common.WS
%import common.CNAME
%import common.LETTER
%import common.DIGIT
%ignore WS
%ignore COMMENT
""".strip()


class JSONTransformer(lark.Transformer):
    def start(self, items):
        imports = []
        while len(items) > 0 and type(items[0]) == lark.lexer.Token:
            imports.append(items.pop(0))
        data = {'functions': items}
        if len(imports) > 0:
            data['imports'] = imports
        return data

    def imp(self, items):
        return items.pop(0)  # The module name

    def func(self, items):
        name = items.pop(0)
        args = []
        while (len(items) > 0 and type(items[0]) == lark.tree.Tree and
            items[0].data == "arg"):
            arg = items.pop(0).children
            args.append(
                dict(name=arg[0], type=arg[1] if len(arg) > 1 else None))
        function_type = items.pop(0) if type(items[0]) == str else None
        data = {'name': str(name), 'instrs': items}
        if len(args):
            data['args'] = args
        if function_type is not None:
            data['type'] = function_type
        return data

    def def_func(self, items):
        return items.pop(0)

    def const(self, items):
        dest = items.pop(0)
        type = items.pop(0)
        val = items.pop(0)
        return {
            'op': 'const',
            'dest': str(dest),
            'type': type,
            'value': val,
        }

    def vop(self, items):
        dest = items.pop(0)
        type = items.pop(0)
        op = items.pop(0)
        return {
            'op': str(op),
            'dest': str(dest),
            'type': type,
            'args': [str(t) for t in items],
         }

    def eop(self, items):
        op = items.pop(0)
        return {
            'op': str(op),
            'args': [str(t) for t in items],
         }

    def label(self, items):
        name = items.pop(0)
        return {
            'label': name,
        }

    def int(self, items):
        return int(str(items[0]))

    def bool(self, items):
        if str(items[0]) == 'true':
            return True
        else:
            return False

    def type(self, items):
        return str(items[0])


def parse_bril(txt):
    parser = lark.Lark(GRAMMAR)
    tree = parser.parse(txt)
    data = JSONTransformer().transform(tree)
    function_names = [f['name'] for f in data['functions']]
    unique = set()
    dups = [f for f in function_names if f in unique and not unique.add(f)]
    if len(dups) > 0:
        raise RuntimeError(
            'Function(s) defined twice: {}'.format(', '.join(dups)))
    return json.dumps(data, indent=2, sort_keys=True)


def unroll_imports(prog):
    if 'imports' not in prog:
        return json.dumps(prog, indent=2, sort_keys=True)
    to_import = set(prog['imports'])
    all_functions_map = {f['name']: f for f in prog['functions']}
    imported = set()
    while len(to_import) > 0:
        module_name = to_import.pop()
        imported.add(module_name)
        try:
            with open('{}.bril'.format(module_name)) as f:
                loaded_prog = json.loads(parse_bril(f.read()))
        except IOError:
            sys.stderr.write('Failed to load {}.bril\n'.format(module_name))
            sys.stderr.flush()
            sys.exit(1)
        imports = set(loaded_prog.get('imports', []))
        to_import.update(imports.difference(imported))
        dups = {f['name'] for f in loaded_prog['functions']}
        dups.intersection_update(all_functions_map.keys())
        if len(dups) > 0:
            raise RuntimeError(
                'Function(s) defined twice: {}'.format(', '.join(dups)))
        all_functions_map.update({f['name']: f for f in loaded_prog['functions']})
    return json.dumps(
        dict(functions=list(all_functions_map.values())),
        indent=2,
        sort_keys=True)


# Text format pretty-printer.

def instr_to_string(instr):
    if instr['op'] == 'const':
        return '{}: {} = const {}'.format(
            instr['dest'],
            instr['type'],
            str(instr['value']).lower(),
        )
    elif 'dest' in instr:
        return '{}: {} = {} {}'.format(
            instr['dest'],
            instr['type'],
            instr['op'],
            ' '.join(instr['args']),
        )
    else:
        return '{} {}'.format(
            instr['op'],
            ' '.join(instr['args']),
        )


def print_instr(instr):
    print('  {};'.format(instr_to_string(instr)))


def print_label(label):
    print('{}:'.format(label['label']))


def print_func(func):
    print('{} {{'.format(func['name'], func.get('type', 'void')))
    for instr_or_label in func['instrs']:
        if 'label' in instr_or_label:
            print_label(instr_or_label)
        else:
            print_instr(instr_or_label)
    print('}')


def print_prog(prog):
    for func in prog['functions']:
        print_func(func)


# Command-line entry points.

def bril2json():
    print(parse_bril(sys.stdin.read()))


def bril2txt():
    print_prog(json.load(sys.stdin))


def loadbril():
    print(json.dumps(unroll_imports(json.load(sys.stdin)), indent=2, sort_keys=True))
