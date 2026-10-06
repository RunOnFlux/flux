#!/usr/bin/env python3
"""Applies a node's own firewall rules to ufw in one pass, under ufw's lock.

Two steps, both while holding the lock every ufw command takes for its whole
run (an exclusive lockf lock on /run/ufw.lock), so no ufw command changes the
rules between them:

1. Every outbound rule is removed from /etc/ufw/user.rules and user6.rules. A
   rule is a block in those files: its '### tuple ###' line, which is ufw's own
   record of the rule, and the iptables lines that follow it up to a blank
   line. A block is removed when ufw would read its tuple as an outbound rule
   that is not a route rule. The tuple is read as ufw's backend reads it: a
   trailing comment= is stripped first, a 7- or 9-field tuple ends in its
   direction ('out', or 'out_<iface>'), a 6- or 8-field one is inbound, and an
   action written 'route:<action>' is a route rule. Each file is written beside
   the old and renamed over it, so it is never seen part-written.

2. The rules given with --rules (a JSON list, each rule the arguments of one
   ufw command, e.g. ["allow", "16127"]) are applied through ufw's own library,
   the code the ufw command runs, so ufw writes each rule's iptables lines. A
   rule ufw refuses is reported and the rest are still applied.

ufw is not reloaded here: the reload takes the same lock, and is needed only
when outbound rules were removed, to take them out of the running firewall.

Prints one JSON object on stdout and exits 0:
  {"removed": <outbound rules removed>, "applied": <bool>, "failed": [...],
   "reason": <why the rules were not applied>}
applied is false when ufw's library could not be used; the caller applies the
rules itself. Exits 75 without changing anything when the lock is not free
within --wait seconds.
"""

import argparse
import fcntl
import json
import os
import re
import sys
import tempfile
import time

LOCK_UNAVAILABLE = 75
PAT_TUPLE = re.compile(r'^### tuple ###\s*')


def is_outbound(tuple_line):
    line = tuple_line.split(' comment=')[0]
    fields = re.split(r'\s+', PAT_TUPLE.sub('', line).strip())
    if len(fields) not in (7, 9):
        return False
    if ':' in fields[0]:
        return False
    return fields[-1].split('_')[0] == 'out'


def strip(text):
    """The file's text without its outbound rule blocks, and how many went."""
    lines = text.split('\n')
    kept = []
    removed = 0
    i = 0
    while i < len(lines):
        line = lines[i]
        if PAT_TUPLE.match(line) and is_outbound(line):
            removed += 1
            i += 1
            while i < len(lines) and lines[i] != '' and not lines[i].startswith('###'):
                i += 1
            # ufw writes each block with the blank line that follows it
            if i < len(lines) and lines[i] == '':
                i += 1
            continue
        kept.append(line)
        i += 1
    return '\n'.join(kept), removed


def replace(path, text):
    stat = os.stat(path)
    directory = os.path.dirname(path)
    fd, staged = tempfile.mkstemp(prefix='.flux-', dir=directory)
    try:
        with os.fdopen(fd, 'w') as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(staged, stat.st_mode & 0o7777)
        os.chown(staged, stat.st_uid, stat.st_gid)
        os.rename(staged, path)
    except BaseException:
        if os.path.exists(staged):
            os.unlink(staged)
        raise
    dir_fd = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(dir_fd)
    finally:
        os.close(dir_fd)


def remove_outbound(files):
    removed = 0
    for path in files:
        if not os.path.exists(path):
            continue
        with open(path) as f:
            text, count = strip(f.read())
        if count:
            replace(path, text)
            removed += count
    return removed


def apply_rules(rules):
    """(failed rules, None), or (None, reason) when ufw's library is not usable."""
    try:
        import gettext
        gettext.install('ufw')
        import ufw.common
        import ufw.frontend
        ui = ufw.frontend.UFWFrontend(False)
    except Exception as error:  # pylint: disable=broad-except
        return None, f'ufw library not usable: {error!r}'
    failed = []
    for args in rules:
        try:
            parsed = ufw.frontend.parse_command(['ufw'] + args)
            ui.do_action(parsed.action, parsed.data.get('rule', ''), parsed.data.get('iptype', ''), True)
        except ufw.common.UFWError as error:
            failed.append({'rule': ' '.join(args), 'error': error.value})
        except (TypeError, AttributeError, ValueError) as error:
            return None, f'ufw library not usable: {error!r}'
    return failed, None


def take_lock(lock_path, wait_seconds):
    lock = open(lock_path, 'w')
    deadline = time.monotonic() + wait_seconds
    while True:
        try:
            fcntl.lockf(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return lock
        except OSError:
            if time.monotonic() >= deadline:
                lock.close()
                return None
            time.sleep(0.05)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--lock', default='/run/ufw.lock')
    parser.add_argument('--wait', type=float, default=30)
    parser.add_argument('--rules', type=json.loads, default=[])
    parser.add_argument('files', nargs='*', default=['/etc/ufw/user.rules', '/etc/ufw/user6.rules'])
    args = parser.parse_args()

    lock = take_lock(args.lock, args.wait)
    if lock is None:
        print(f'ufw lock {args.lock} not free within {args.wait:g}s', file=sys.stderr)
        return LOCK_UNAVAILABLE

    result = sys.stdout
    # ufw's library prints its own messages; stdout carries only the result.
    sys.stdout = sys.stderr
    try:
        removed = remove_outbound(args.files)
        failed, reason = apply_rules(args.rules) if args.rules else ([], None)
    finally:
        lock.close()
        sys.stdout = result
    print(json.dumps({'removed': removed, 'applied': reason is None, 'failed': failed or [], 'reason': reason}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
