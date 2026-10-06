#!/usr/bin/env python3
"""Removes every outbound rule from ufw's rules files in one pass.

A rule is a block in /etc/ufw/user.rules or user6.rules: its '### tuple ###'
line, which is ufw's own record of the rule, and the iptables lines that
follow it up to a blank line. A block is removed when ufw would read its tuple
as an outbound rule that is not a route rule. The tuple is read as ufw's
backend reads it: a trailing comment= is stripped first, a 7- or 9-field tuple
ends in its direction ('out', or 'out_<iface>'), a 6- or 8-field one is
inbound, and an action written 'route:<action>' is a route rule.

Each file is written to a new file beside it and renamed over it, so it is
never seen part-written. The whole pass holds ufw's own lock, the exclusive
lockf lock every ufw command takes for its whole run, so no ufw command
changes the files between the read and the rename. ufw is not reloaded here:
the reload takes the same lock.

Prints {"removed": <count>} and exits 0. Exits 75 without changing anything
when the lock is not free within --wait seconds.
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
    parser.add_argument('files', nargs='*', default=['/etc/ufw/user.rules', '/etc/ufw/user6.rules'])
    args = parser.parse_args()

    lock = take_lock(args.lock, args.wait)
    if lock is None:
        print(f'ufw lock {args.lock} not free within {args.wait:g}s', file=sys.stderr)
        return LOCK_UNAVAILABLE
    try:
        removed = 0
        for path in args.files:
            if not os.path.exists(path):
                continue
            with open(path) as f:
                text, count = strip(f.read())
            if count:
                replace(path, text)
                removed += count
        print(json.dumps({'removed': removed}))
        return 0
    finally:
        lock.close()


if __name__ == '__main__':
    sys.exit(main())
