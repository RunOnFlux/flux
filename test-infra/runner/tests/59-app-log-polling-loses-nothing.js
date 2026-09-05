// weight: medium
/*
 * /apps/applogpolling, against a container that is genuinely writing logs.
 *
 * The endpoint is what a browser polls on a timer to show an app's logs, and it
 * had two defects a unit test cannot see, because both are about what docker does
 * rather than what FluxOS passes it.
 *
 * COST. It asked docker for `follow: true`, which never closes, so the only way
 * out was a 1500ms timer: every poll took 1500ms to answer whether one line was
 * waiting or none. Measured directly against a live container before the change:
 * 1526ms, 1507ms, 1507ms, each returning a single line.
 *
 * LOSS. It asked for the last N lines and the reader replaced its view with them,
 * so anything written between two polls beyond N was never shown to anyone and
 * could not be fetched afterwards. `since` did not help: it was a box a user typed
 * in, never advanced, and docker applies `tail` AFTER `since` anyway, so a burst of
 * 500 lines with tail:100 answers a reader asking for everything since T with the
 * last 100 and no sign the rest existed.
 *
 * The fix is a position the reader hands back. Its correctness rests on docker
 * semantics that are pinned in unit tests against a crafted buffer
 * (dockerService.test.js, 'dockerContainerLogsPolling') - but a crafted buffer is
 * the author's belief about docker, not docker. What this suite adds is the real
 * daemon, a container writing on its own schedule, and the only assertion that
 * matters end to end: across a run of polls, every line the container wrote is seen
 * EXACTLY ONCE, in order, with no gap.
 *
 * The lines are numbered by the container itself, which is what makes that
 * checkable: a gap and a repeat are both visible in the sequence, and identical
 * lines would hide both.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { listAppContainers } from '../framework/container.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

describe('a log poll answers at once and loses nothing between polls', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2elogpoll${Date.now()}`;
  const component = `${appName}a`;
  const identifier = `${component}_${appName}`;
  let holder;
  let auth;

  // The container writes `log line <n>`; this is the <n>. Anything that is not a
  // numbered line (docker's own timestamp prefix is stripped by the endpoint) is
  // returned as null so a malformed line fails the sequence rather than vanishing
  // from it.
  const lineNumber = (line) => {
    const match = /log line (\d+)\s*$/.exec(line);
    return match ? Number(match[1]) : null;
  };

  async function poll(cursor) {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    const body = await holder.getAuthed(`/apps/applogpolling/${identifier}/100${query}`, auth.zelidauth);
    expect(body.status, `applogpolling refused: ${JSON.stringify(body).slice(0, 300)}`).to.equal('success');
    return body;
  }

  before(async function () {
    this.timeout(420000);

    env = await createTestEnv({ hookCtx: this, nodes: 3, tickerAutostart: false });
    await bootAndPeer(env);
    [holder] = env.clients;

    await pushTestApp(appName, 'v1');
    const app = await buildSeedableApp({
      env,
      name: appName,
      compose: [{
        name: component,
        description: 'writes numbered log lines on an interval',
        repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
        ports: [],
        domains: [''],
        // 100ms: fast enough that several lines land between two polls, so the
        // gap this suite is looking for would actually have somewhere to open.
        // The writer alternates stdout and stderr, which is what puts the log
        // out of timestamp order - the case a stdout-only writer cannot produce
        // and which delivered lines twice before the position counted its place
        // in docker's order rather than by millisecond.
        environmentParameters: ['LOG_EVERY_MS=100'],
        commands: [],
        containerPorts: [80],
        containerData: '/tmp',
        cpu: 0.1,
        ram: 100,
        hdd: 1,
        repoauth: '',
      }],
    });

    await installOnNodes(env, app, [0]);
    await waitFor(
      async () => {
        const containers = await listAppContainers(holder.container, { all: true });
        return containers.find((c) => c.name === `flux${identifier}`)?.status?.startsWith('Up');
      },
      { timeout: 120000, interval: 2000, label: 'the log-writing component is running' },
    );

    auth = await authenticate(holder.url, appOwnerKey());

    // Lines must actually be arriving before anything is measured: a poll over an
    // empty log satisfies "no duplicates and no gaps" without proving any of it.
    await waitFor(
      async () => (await poll()).logs.some((line) => lineNumber(line) !== null),
      { timeout: 60000, interval: 1000, label: 'the container is writing log lines' },
    );
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('answers a poll without waiting on a timer', async function () {
    this.timeout(60000);

    // Five, because the defect was a fixed 1500ms floor: one fast answer could be
    // luck, five cannot. Judged against 1000ms rather than the observed few ms -
    // this is a fleet under load, and the claim is "no fixed wait", not a latency
    // budget.
    const timings = [];
    for (let i = 0; i < 5; i += 1) {
      const started = Date.now();
      // eslint-disable-next-line no-await-in-loop
      await poll();
      timings.push(Date.now() - started);
    }

    expect(
      Math.max(...timings),
      `a poll still waits on a timer: ${timings.join('ms, ')}ms`,
    ).to.be.below(1000);
  });

  it('hands back a position, and answers it with only what came after', async function () {
    this.timeout(60000);

    const first = await poll();
    expect(first.cursor, 'a node that cannot answer a position leaves the reader on tail-and-replace').to.be.a('string');
    const seen = first.logs.map(lineNumber).filter((n) => n !== null);
    expect(seen, 'nothing to reason about without lines').to.not.be.empty;

    await new Promise((resolve) => { setTimeout(resolve, 1000); });

    const second = await poll(first.cursor);
    const next = second.logs.map(lineNumber).filter((n) => n !== null);

    expect(second.rolledOver, 'the position was one poll old').to.be.false;
    expect(next, 'a second poll answered with nothing new').to.not.be.empty;
    expect(
      Math.min(...next),
      'a line already delivered was delivered again',
    ).to.be.above(Math.max(...seen));
  });

  it('sees every line exactly once across a run of polls', async function () {
    this.timeout(120000);

    // The whole point. Ten polls a second apart, over a container writing ten
    // lines a second, so each poll has several new lines to carry and any dropped
    // or repeated line shows up as a break in the sequence.
    let cursor = (await poll()).cursor;
    const collected = [];

    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => { setTimeout(resolve, 1000); });
      // eslint-disable-next-line no-await-in-loop
      const body = await poll(cursor);
      expect(body.rolledOver, 'docker discarded a line this reader had not read').to.be.false;
      body.logs.map(lineNumber).forEach((n) => {
        expect(n, `unparseable log line: ${JSON.stringify(body.logs)}`).to.not.equal(null);
        collected.push(n);
      });
      cursor = body.cursor;
    }

    expect(collected.length, 'ten polls over a container writing ten lines a second').to.be.above(10);
    expect(
      new Set(collected).size,
      `a line was delivered twice: ${collected.join(',')}`,
    ).to.equal(collected.length);

    // Contiguous and ascending. A gap is a line the container wrote that no poll
    // ever carried - the failure this whole design exists to prevent, and the one
    // a reader could never detect for itself.
    for (let i = 1; i < collected.length; i += 1) {
      expect(
        collected[i],
        `a gap between ${collected[i - 1]} and ${collected[i]}`,
      ).to.equal(collected[i - 1] + 1);
    }
  });

  // These must hold on a node WITHOUT this change as well as one with it, because
  // that is the whole claim: every deployed client asks these three ways today
  // and nodes upgrade one at a time. Asserting anything this change added - a
  // cursor, rolledOver, hasMore - would make them tests of the new code wearing
  // a compatibility test's name. They assert only what both versions answer,
  // and `truncated` is one of those: it belongs to the line limit it always
  // belonged to.
  it('still answers a reader that has never heard of a position', async function () {
    this.timeout(60000);

    const body = await poll();

    expect(body.logs.map(lineNumber).filter((n) => n !== null), 'the tail answer is empty').to.not.be.empty;
  });

  // The `Logs Since` box in a log viewer. It is a filter someone typed, not a
  // claim to hold lines - so it keeps its line count. Treating it as a position
  // dropped that count and answered "everything since then", and reported logs
  // as rolled away because a typed timestamp does not land on a log line.
  it('honours the line count when a since filter is given', async function () {
    this.timeout(60000);

    const since = new Date(Date.now() - 60000).toISOString();
    const body = await holder.getAuthed(`/apps/applogpolling/${identifier}/5/${since}`, auth.zelidauth);

    expect(body.status, `applogpolling refused: ${JSON.stringify(body).slice(0, 300)}`).to.equal('success');
    expect(body.logs.length, 'a since filter that ignores its line count returns the whole minute').to.be.at.most(5);
    expect(body.logs.map(lineNumber).filter((n) => n !== null), 'nothing came back').to.not.be.empty;
  });

  // `all` is what the download button asks for. It is not a page and the caller
  // is not coming back, so an answer capped from the oldest end hands back the
  // START of the log to someone who asked for its end.
  it('does not truncate a reader asking for every line', async function () {
    this.timeout(60000);

    const tail = await holder.getAuthed(`/apps/applogpolling/${identifier}/5`, auth.zelidauth);
    const all = await holder.getAuthed(`/apps/applogpolling/${identifier}/all`, auth.zelidauth);

    expect(all.status, `applogpolling refused: ${JSON.stringify(all).slice(0, 300)}`).to.equal('success');
    const newest = Math.max(...all.logs.map(lineNumber).filter((n) => n !== null));
    const tailNewest = Math.max(...tail.logs.map(lineNumber).filter((n) => n !== null));

    expect(all.logs.length, 'every line means more than a page of them').to.be.above(5);
    // The line limit's own answer, unchanged: five asked for, five returned, and
    // the log holds more. A reader that sends no position is told this and
    // nothing else - it is the only signal it has ever had.
    expect(tail.truncated, 'five returned out of more than five is not the whole log').to.be.true;
    expect(all.truncated, "'all' is not a line limit").to.be.false;
    // The failure this catches is subtle: capping kept the OLDEST lines, so the
    // answer was large and looked healthy while ending near the start of the log.
    expect(newest, 'an answer for `all` that stops short of the newest line is truncated').to.be.at.least(tailNewest);
  });
});
