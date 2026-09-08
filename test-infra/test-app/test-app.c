/*
 * Configurable test container for the reconciler integration suites.
 *
 * Compiled to a small static linux/amd64 binary and pushed into the per-test
 * registry as a single-layer image (see registry-helper.pushTestApp). Behaviour
 * is driven entirely by env vars, supplied through an app spec's
 * environmentParameters, so one image serves every exit scenario:
 *
 *   EXIT_CODE     exit status to use on a signal / timed exit (default 0)
 *   EXIT_AFTER_S  if > 0, self-exit with EXIT_CODE after this many seconds
 *                 (models a container that exits on its own, e.g. exit 0 to
 *                 free memory); if unset, stay up until signalled
 *   BURN_CPU      number of spinners to run, so the container reports sustained
 *                 load to the monitoring suites. One spinner saturates one core,
 *                 so this must be at least the app's cpu allocation or the
 *                 container idles below its limit and never looks busy. Docker
 *                 caps the container at its NanoCpus allocation, so the spinners
 *                 consume the app's own share and no more. Unset (the default)
 *                 leaves the idle pause loop every other suite relies on.
 *   BURN_FOR_S    if > 0, spin for this many seconds and then go idle, without
 *                 the container ever stopping. A test that needs the load to end
 *                 cannot signal it away — docker kill reaches the main process
 *                 only, and the spinners are forked children — and docker pause
 *                 would freeze the container out of the sampler's view.
 *   LOG_EVERY_MS  if > 0, write `log line <n>` on this interval, numbered from 1
 *                 and never repeating. Numbered because that is what lets a
 *                 reader prove it saw every line exactly once: a gap or a repeat
 *                 in the sequence is visible, and identical lines would hide
 *                 both.
 *
 *   LOG_BLOB_BYTES  if > 0, ONE line of this many bytes with no newline in it,
 *                 written after every LOG_BLOB_AFTER numbered lines and
 *                 terminated only once it is complete. A reader holds a line
 *                 until its newline arrives, so this is what a container that
 *                 does not send one costs it - and the numbered lines resume
 *                 afterwards, which is what says a reader that gave up on the
 *                 blob did not give up on what followed it. Repeated rather
 *                 than written once, so a viewer that attaches at any point
 *                 meets one rather than having to be there at the start.
 *   LOG_BLOB_AFTER  how many numbered lines between blobs (default 50).
 *
 *                 Lines ALTERNATE between stdout and stderr, and that is the
 *                 point rather than decoration. Docker gives each stream its own
 *                 writer, and each stamps its line before the write is
 *                 serialised into the log - so the file is not in timestamp
 *                 order (3,304 backwards steps in 40,000 lines, measured). A
 *                 reader that assumes it is delivers some lines twice. A
 *                 stdout-only writer cannot produce that and so cannot test for
 *                 it.
 *
 * On SIGTERM/SIGINT (i.e. `docker stop`) it exits with EXIT_CODE, so a test can
 * deterministically produce a clean exit 0 or any non-zero code on demand.
 * Static + freestanding: it runs in an otherwise-empty rootfs (no libc loader,
 * no shell), exactly like the /bin/pause fixture.
 */
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <signal.h>
#include <time.h>

static int exit_code = 0;

static void on_signal(int sig)
{
    (void)sig;
    _exit(exit_code);
}

int main(void)
{
    const char *ec = getenv("EXIT_CODE");
    if (ec)
        exit_code = atoi(ec);

    signal(SIGTERM, on_signal);
    signal(SIGINT, on_signal);

    const char *after = getenv("EXIT_AFTER_S");
    if (after) {
        int seconds = atoi(after);
        if (seconds > 0) {
            sleep((unsigned)seconds);
            return exit_code;
        }
    }

    const char *burn = getenv("BURN_CPU");
    if (burn) {
        int spinners = atoi(burn);
        if (spinners < 1)
            spinners = 1;

        const char *burn_for_s = getenv("BURN_FOR_S");
        long burn_for = burn_for_s ? atol(burn_for_s) : 0;

        /* children inherit the handlers, so docker stop still ends all of them */
        int is_child = 0;
        for (int i = 1; i < spinners; i++) {
            if (fork() == 0) {
                is_child = 1;
                break;
            }
        }

        /* volatile so the compiler cannot optimise the loop away at -Os */
        volatile unsigned long spin = 0;
        const time_t started = time(NULL);
        for (;;) {
            spin++;
            /* checking the clock every iteration would cost more than the spin */
            if (burn_for > 0 && (spin & 0xFFFFFF) == 0
                && time(NULL) - started >= burn_for)
                break;
        }

        if (is_child)
            _exit(0);
    }

    const char *log_every = getenv("LOG_EVERY_MS");
    if (log_every) {
        long interval_ms = atol(log_every);
        if (interval_ms > 0) {
            const struct timespec gap = {
                .tv_sec = interval_ms / 1000,
                .tv_nsec = (interval_ms % 1000) * 1000000L,
            };
            const char *blob_bytes = getenv("LOG_BLOB_BYTES");
            const long blob = blob_bytes ? atol(blob_bytes) : 0;
            const char *blob_after_s = getenv("LOG_BLOB_AFTER");
            const unsigned long blob_after =
                blob_after_s ? strtoul(blob_after_s, NULL, 10) : 50;

            char line[64];
            char filler[4096];
            for (size_t i = 0; i < sizeof(filler); i++)
                filler[i] = 'B';

            for (unsigned long n = 1;; n++) {
                int len = snprintf(line, sizeof(line), "log line %lu\n", n);
                if (len > 0)
                    (void)!write(n & 1 ? STDOUT_FILENO : STDERR_FILENO,
                                 line, (size_t)len);

                /* One line, written in pieces, with its newline only at the end:
                 * what a reader holds is decided by the container, not by the
                 * writes. On stdout alone, so the blob's own pieces cannot
                 * interleave with the stderr half of the numbered lines. */
                if (blob > 0 && blob_after > 0 && n % blob_after == 0) {
                    long written = 0;
                    while (written < blob) {
                        long want = blob - written;
                        if (want > (long)sizeof(filler))
                            want = (long)sizeof(filler);
                        (void)!write(STDOUT_FILENO, filler, (size_t)want);
                        written += want;
                    }
                    (void)!write(STDOUT_FILENO, "\n", 1);
                }

                nanosleep(&gap, NULL);
            }
        }
    }

    for (;;)
        pause();

    return 0;
}
