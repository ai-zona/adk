import { SandboxConfigSchema } from "./types";
import type { SandboxConfig } from "./types";

// ──────────────────────────────────────────────────────
// Sandbox Configuration Builder
// ──────────────────────────────────────────────────────
// Provides predefined sandbox profiles and a fluent builder
// for constructing validated sandbox configurations.
// ──────────────────────────────────────────────────────

/**
 * Predefined sandbox profiles for common agent workloads.
 *
 * - `minimal`:       Low-resource agents (simple lookups, lightweight tasks).
 * - `standard`:      Default profile for most agents.
 * - `compute`:       CPU/memory-intensive agents (ML inference, data processing).
 * - `unrestricted`:  Full access for trusted, first-party agents.
 */
export const SANDBOX_PROFILES = {
  minimal: {
    cpuLimit: "0.25",
    memoryLimit: "256Mi",
    timeoutSeconds: 60,
    networkPolicy: "restricted" as const,
    gpuRequired: false,
    maxConcurrency: 5,
    env: {},
  },
  standard: {
    cpuLimit: "1",
    memoryLimit: "512Mi",
    timeoutSeconds: 300,
    networkPolicy: "restricted" as const,
    gpuRequired: false,
    maxConcurrency: 10,
    env: {},
  },
  compute: {
    cpuLimit: "2",
    memoryLimit: "2Gi",
    timeoutSeconds: 600,
    networkPolicy: "egress-only" as const,
    gpuRequired: false,
    maxConcurrency: 5,
    env: {},
  },
  unrestricted: {
    cpuLimit: "4",
    memoryLimit: "4Gi",
    timeoutSeconds: 1800,
    networkPolicy: "full" as const,
    gpuRequired: false,
    maxConcurrency: 20,
    env: {},
  },
} as const satisfies Record<string, SandboxConfig>;

export type SandboxProfile = keyof typeof SANDBOX_PROFILES;

/**
 * Fluent builder for constructing sandbox configurations.
 *
 * Optionally starts from a predefined profile, then allows
 * fine-grained overrides before producing a validated config.
 *
 * @example
 * ```ts
 * const config = new SandboxConfigBuilder("compute")
 *   .setGpuRequired(true)
 *   .addAllowedDomain("api.openai.com")
 *   .setEnv("MODEL_ID", "gpt-4")
 *   .build();
 * ```
 */
export class SandboxConfigBuilder {
  private config: SandboxConfig;

  constructor(profile?: SandboxProfile) {
    if (profile && profile in SANDBOX_PROFILES) {
      // Deep-copy the profile so mutations do not affect the static profiles
      this.config = { ...SANDBOX_PROFILES[profile], env: { ...SANDBOX_PROFILES[profile].env } };
    } else {
      this.config = SandboxConfigSchema.parse({});
    }
  }

  setCpuLimit(limit: string): this {
    this.config.cpuLimit = limit;
    return this;
  }

  setMemoryLimit(limit: string): this {
    this.config.memoryLimit = limit;
    return this;
  }

  setTimeoutSeconds(timeout: number): this {
    this.config.timeoutSeconds = timeout;
    return this;
  }

  setNetworkPolicy(policy: "restricted" | "egress-only" | "full"): this {
    this.config.networkPolicy = policy;
    return this;
  }

  setGpuRequired(required: boolean): this {
    this.config.gpuRequired = required;
    return this;
  }

  setMaxConcurrency(max: number): this {
    this.config.maxConcurrency = max;
    return this;
  }

  addAllowedDomain(domain: string): this {
    if (!this.config.allowedDomains) {
      this.config.allowedDomains = [];
    }
    if (!this.config.allowedDomains.includes(domain)) {
      this.config.allowedDomains.push(domain);
    }
    return this;
  }

  setEnv(key: string, value: string): this {
    this.config.env[key] = value;
    return this;
  }

  /**
   * Validate and return the final sandbox configuration.
   * Throws a ZodError if the configuration is invalid.
   */
  build(): SandboxConfig {
    return SandboxConfigSchema.parse(this.config);
  }

  // ──────────────────────────────────────────────────────
  // Static Validation Utilities
  // ──────────────────────────────────────────────────────

  /**
   * Validate a sandbox configuration and return a list of human-readable errors.
   * Returns an empty array if the configuration is valid.
   */
  static validate(config: SandboxConfig): string[] {
    const errors: string[] = [];

    // Schema-level validation
    const result = SandboxConfigSchema.safeParse(config);
    if (!result.success) {
      for (const issue of result.error.issues) {
        errors.push(`${issue.path.join(".")}: ${issue.message}`);
      }
      return errors;
    }

    // Semantic validation
    const parsed = result.data;

    // CPU limit should be a parseable number
    const cpuValue = Number.parseFloat(parsed.cpuLimit);
    if (Number.isNaN(cpuValue) || cpuValue <= 0) {
      errors.push(`cpuLimit: must be a positive number string, got "${parsed.cpuLimit}"`);
    } else if (cpuValue > 16) {
      errors.push(`cpuLimit: exceeds maximum of 16 vCPUs, got "${parsed.cpuLimit}"`);
    }

    // Memory limit format validation (must end with Mi or Gi)
    const memoryMatch = parsed.memoryLimit.match(/^(\d+)(Mi|Gi)$/);
    if (!memoryMatch) {
      errors.push(
        `memoryLimit: must match format "<number>Mi" or "<number>Gi", got "${parsed.memoryLimit}"`,
      );
    } else {
      const memValue = Number.parseInt(memoryMatch[1]!, 10);
      const memUnit = memoryMatch[2];
      const memMb = memUnit === "Gi" ? memValue * 1024 : memValue;
      if (memMb > 32768) {
        errors.push(`memoryLimit: exceeds maximum of 32Gi (32768Mi), got "${parsed.memoryLimit}"`);
      }
    }

    // Timeout bounds
    if (parsed.timeoutSeconds > 7200) {
      errors.push(`timeoutSeconds: exceeds maximum of 7200 seconds, got ${parsed.timeoutSeconds}`);
    }

    // Allowed domains only make sense for egress-only
    if (
      parsed.allowedDomains &&
      parsed.allowedDomains.length > 0 &&
      parsed.networkPolicy !== "egress-only"
    ) {
      errors.push(
        `allowedDomains: only applicable when networkPolicy is "egress-only", current policy is "${parsed.networkPolicy}"`,
      );
    }

    return errors;
  }

  /**
   * Generate a seccomp-like restriction profile from the sandbox configuration.
   *
   * This is a documentation/planning utility for future Docker/Firecracker integration.
   * The returned object describes the intended security restrictions, not an actual
   * seccomp profile that can be loaded directly.
   */
  static toSeccompProfile(config: SandboxConfig): Record<string, unknown> {
    const profile: Record<string, unknown> = {
      defaultAction: "SCMP_ACT_ERRNO",
      architectures: ["SCMP_ARCH_X86_64", "SCMP_ARCH_AARCH64"],
      syscalls: [] as Record<string, unknown>[],
    };

    // Base allowed syscalls for all sandbox types
    const baseSyscalls = [
      "read",
      "write",
      "open",
      "close",
      "stat",
      "fstat",
      "lstat",
      "poll",
      "lseek",
      "mmap",
      "mprotect",
      "munmap",
      "brk",
      "ioctl",
      "access",
      "pipe",
      "select",
      "sched_yield",
      "mremap",
      "msync",
      "mincore",
      "madvise",
      "dup",
      "dup2",
      "nanosleep",
      "getpid",
      "clone",
      "fork",
      "execve",
      "exit",
      "wait4",
      "kill",
      "uname",
      "fcntl",
      "flock",
      "fsync",
      "fdatasync",
      "truncate",
      "ftruncate",
      "getdents",
      "getcwd",
      "chdir",
      "mkdir",
      "rmdir",
      "creat",
      "unlink",
      "readlink",
      "chmod",
      "fchmod",
      "chown",
      "fchown",
      "lchown",
      "umask",
      "gettimeofday",
      "getrlimit",
      "getrusage",
      "sysinfo",
      "times",
      "getuid",
      "getgid",
      "geteuid",
      "getegid",
      "getppid",
      "getpgrp",
      "setsid",
      "setpgid",
      "clock_gettime",
      "clock_getres",
      "clock_nanosleep",
      "exit_group",
      "epoll_create",
      "epoll_ctl",
      "epoll_wait",
      "futex",
      "set_tid_address",
      "set_robust_list",
    ];

    // Network syscalls (only if not restricted)
    const networkSyscalls = [
      "socket",
      "connect",
      "accept",
      "sendto",
      "recvfrom",
      "sendmsg",
      "recvmsg",
      "bind",
      "listen",
      "getsockname",
      "getpeername",
      "socketpair",
      "setsockopt",
      "getsockopt",
    ];

    const allowedSyscalls = [...baseSyscalls];

    if (config.networkPolicy !== "restricted") {
      allowedSyscalls.push(...networkSyscalls);
    }

    (profile.syscalls as Record<string, unknown>[]).push({
      names: allowedSyscalls,
      action: "SCMP_ACT_ALLOW",
    });

    // Resource limits
    profile.resourceLimits = {
      cpu: config.cpuLimit,
      memory: config.memoryLimit,
      timeout: config.timeoutSeconds,
      gpu: config.gpuRequired,
    };

    // Network policy
    profile.networkPolicy = {
      type: config.networkPolicy,
      allowedDomains: config.allowedDomains ?? [],
    };

    return profile;
  }
}
