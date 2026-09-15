// Interposer: log all read()/write()/open() on /dev/cu.usbmodem* fds.
// __DATA,__interpose + RAW SYSCALL passthrough (no dlsym, no libc I/O in hooks).
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>
#include <unistd.h>
#include <sys/types.h>
#include <sys/syscall.h>
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"

#define DYLD_INTERPOSE(_replacement, _replacee) \
    __attribute__((used)) static struct { const void *replacement; const void *replacee; } \
    _interpose_##_replacee __attribute__((section("__DATA,__interpose"))) = { \
        (const void *)(unsigned long)&_replacement, (const void *)(unsigned long)&_replacee }

#define LOGPATH "/tmp/naya-cdc.log"

static _Thread_local int in_hook = 0;

/* gate: only log inside NayaCore (the dylib will also load into
   Electron UI/helpers when injected via app launch env) */
static int active = 0;

__attribute__((constructor)) static void on_load(void) {
    const char *pn = getprogname();
    if (pn && strstr(pn, "NayaCore")) active = 1;
    int fd = syscall(SYS_open, "/tmp/interposer-loaded",
                     O_WRONLY | O_CREAT | O_APPEND, 0644);
    if (fd != -1) {
        char m[160];
        int ml = snprintf(m, sizeof(m), "loaded in %s active=%d\n",
                          pn ? pn : "?", active);
        syscall(SYS_write, fd, m, ml);
        syscall(SYS_close, fd);
    }
}

/* fcntl F_GETPATH via raw syscall to avoid libc wrapper */
static int fd_is_usbmodem(int fd) {
    char buf[256];
    /* fcntl is variadic; use libc fcntl but guarded (no I/O inside) */
    extern int fcntl(int, int, ...);
    if (fcntl(fd, 50 /* F_GETPATH */, buf) == -1) return 0;
    return strstr(buf, "usbmodem") != NULL;
}

static int log_fd(void) {
    return syscall(SYS_open, LOGPATH, O_WRONLY | O_CREAT | O_APPEND, 0644);
}

static void log_rw(const char *dir, int fd, const void *buf, long len) {
    if (in_hook) return;
    in_hook = 1;
    int lfd = log_fd();
    if (lfd != -1) {
        char hdr[320], path[256] = {0};
        extern int fcntl(int, int, ...);
        fcntl(fd, 50, path);
        int hl = 0;
        const char *p;
        for (p = dir; *p && hl < 8;) hdr[hl++] = *p++;
        hdr[hl++] = ' ';
        hl += snprintf(hdr + hl, sizeof(hdr) - hl, "fd=%d %s len=%ld\n", fd, path, len);
        syscall(SYS_write, lfd, hdr, hl);
        const unsigned char *b = buf;
        char line[128];
        for (long i = 0; i < len;) {
            int n = 0;
            for (int k = 0; k < 32 && i < len; k++, i++)
                n += snprintf(line + n, sizeof(line) - n, "%02x ", b[i]);
            line[n++] = '\n';
            syscall(SYS_write, lfd, line, n);
        }
        syscall(SYS_write, lfd, "---\n", 4);
        syscall(SYS_close, lfd);
    }
    in_hook = 0;
}

static int do_open(const char *path, int flags, int mode) {
    int fd = syscall(SYS_open, path, flags, mode);
    if (active && fd != -1 && path && strstr(path, "usbmodem") && !in_hook) {
        in_hook = 1;
        int lfd = log_fd();
        if (lfd != -1) {
            char hdr[320];
            int hl = snprintf(hdr, sizeof(hdr), "OPEN fd=%d %s\n---\n", fd, path);
            syscall(SYS_write, lfd, hdr, hl);
            syscall(SYS_close, lfd);
        }
        in_hook = 0;
    }
    return fd;
}

int my_open(const char *path, int flags, ...) {
    int mode = 0;
    if (flags & O_CREAT) { va_list ap; va_start(ap, flags); mode = va_arg(ap, int); va_end(ap); }
    return do_open(path, flags, mode);
}
DYLD_INTERPOSE(my_open, open);

extern int open$NOCANCEL(const char *path, int flags, ...);
int my_open_NOCANCEL(const char *path, int flags, ...) {
    int mode = 0;
    if (flags & O_CREAT) { va_list ap; va_start(ap, flags); mode = va_arg(ap, int); va_end(ap); }
    return do_open(path, flags, mode);
}
DYLD_INTERPOSE(my_open_NOCANCEL, open$NOCANCEL);

extern long read$NOCANCEL(int fd, void *buf, unsigned long n);
extern long write$NOCANCEL(int fd, const void *buf, unsigned long n);

long my_read(int fd, void *buf, unsigned long n) {
    long r = syscall(SYS_read, fd, buf, n);
    if (active && r > 0 && fd_is_usbmodem(fd)) log_rw("READ ", fd, buf, r);
    return r;
}
DYLD_INTERPOSE(my_read, read);

long my_read_NOCANCEL(int fd, void *buf, unsigned long n) {
    long r = syscall(SYS_read, fd, buf, n);
    if (active && r > 0 && fd_is_usbmodem(fd)) log_rw("READ ", fd, buf, r);
    return r;
}
DYLD_INTERPOSE(my_read_NOCANCEL, read$NOCANCEL);

long my_write(int fd, const void *buf, unsigned long n) {
    long r = syscall(SYS_write, fd, buf, n);
    if (active && r > 0 && fd_is_usbmodem(fd)) log_rw("WRITE", fd, buf, r);
    return r;
}
DYLD_INTERPOSE(my_write, write);

long my_write_NOCANCEL(int fd, const void *buf, unsigned long n) {
    long r = syscall(SYS_write, fd, buf, n);
    if (active && r > 0 && fd_is_usbmodem(fd)) log_rw("WRITE", fd, buf, r);
    return r;
}
DYLD_INTERPOSE(my_write_NOCANCEL, write$NOCANCEL);
