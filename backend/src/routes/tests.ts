import { FastifyPluginAsync } from 'fastify';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

type TestTarget = 'backend' | 'frontend' | 'all';

type TestCase = {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  duration?: number;
  error?: string;
};

type TestSuite = {
  name: string;
  tests: TestCase[];
  passed: number;
  failed: number;
  skipped: number;
  total: number;
};

type RunResult = {
  target: 'backend' | 'frontend';
  code: number;
  durationMs: number;
  output: string;
  suites?: TestSuite[];
  summary?: {
    totalTests: number;
    passed: number;
    failed: number;
    skipped: number;
  };
};

/**
 * Parse vitest output to extract test suites and individual test results
 */
const parseVitestOutput = (output: string): { suites: TestSuite[]; summary?: RunResult['summary'] } => {
  const suites: TestSuite[] = [];
  const lines = output.split('\n');

  let currentSuite: TestSuite | null = null;
  let totalTests = 0;
  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  for (const line of lines) {
    // Match test file headers like "✓ src/__tests__/ocr.test.ts (3 tests)"
    const suiteMatch = line.match(/[✓❯]\s+(.+\.test\.ts)\s+\((\d+)\s+tests?\)/);
    if (suiteMatch) {
      if (currentSuite) {
        suites.push(currentSuite);
      }
      const failed = line.includes('❯');
      currentSuite = {
        name: suiteMatch[1],
        tests: [],
        passed: failed ? 0 : Number.parseInt(suiteMatch[2], 10),
        failed: failed ? Number.parseInt(suiteMatch[2], 10) : 0,
        skipped: 0,
        total: Number.parseInt(suiteMatch[2], 10)
      };
    }

    // Match individual test results
    const passMatch = line.match(/✓\s+(.+?)\s+(\d+m?s)/);
    if (passMatch && currentSuite) {
      currentSuite.tests.push({
        name: passMatch[1].trim(),
        status: 'pass',
        duration: Number.parseFloat(passMatch[2])
      });
    }

    const failMatch = line.match(/×\s+(.+?)(?:\s+(\d+m?s))?$/);
    if (failMatch && currentSuite) {
      currentSuite.tests.push({
        name: failMatch[1].trim(),
        status: 'fail',
        duration: failMatch[2] ? Number.parseFloat(failMatch[2]) : undefined
      });
    }
  }

  if (currentSuite) {
    suites.push(currentSuite);
  }

  // Extract summary from lines like "Test Files  1 failed | 3 passed (4)"
  const summaryMatch = output.match(/Test Files\s+(?:(\d+)\s+failed\s+\|\s+)?(\d+)\s+passed/);
  const testsMatch = output.match(/Tests\s+(?:(\d+)\s+failed\s+\|\s+)?(\d+)\s+passed\s+\((\d+)\)/);

  if (testsMatch) {
    totalFailed = testsMatch[1] ? Number.parseInt(testsMatch[1], 10) : 0;
    totalPassed = Number.parseInt(testsMatch[2], 10);
    totalTests = Number.parseInt(testsMatch[3], 10);
  }

  return {
    suites,
    summary: testsMatch ? {
      totalTests,
      passed: totalPassed,
      failed: totalFailed,
      skipped: totalTests - totalPassed - totalFailed
    } : undefined
  };
};

const runCommand = (command: string, args: string[], cwd: string) =>
  new Promise<RunResult>((resolve) => {
    const start = Date.now();
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, FORCE_COLOR: '0' },
      shell: false
    });

    let output = '';
    let finished = false;
    const appendOutput = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > 50000) {
        output = output.slice(-50000);
      }
    };

    child.stdout.on('data', appendOutput);
    child.stderr.on('data', appendOutput);

    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      if (finished) return;
      finished = true;
      resolve({
        target: cwd.endsWith('frontend') ? 'frontend' : 'backend',
        code: -1,
        durationMs: Date.now() - start,
        output: `${output}\n[timeout] Test run exceeded time limit.`
      });
    }, 5 * 60 * 1000);

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (finished) return;
      finished = true;

      const parsed = parseVitestOutput(output);

      resolve({
        target: cwd.endsWith('frontend') ? 'frontend' : 'backend',
        code: code ?? -1,
        durationMs: Date.now() - start,
        output,
        ...parsed
      });
    });
  });

const testsRoutes: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.post<{ Body: { target?: TestTarget } }>('/run', async (request, reply) => {
    const allowTests =
      process.env.ENABLE_TEST_RUNNER === 'true' || process.env.NODE_ENV !== 'production';

    if (!allowTests) {
      return reply.code(403).send({ message: 'Test runner is disabled.' });
    }

    const target = request.body?.target ?? 'all';
    if (!['backend', 'frontend', 'all'].includes(target)) {
      return reply.code(400).send({ message: 'Invalid test target.' });
    }

    const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const results: RunResult[] = [];

    const runTargets =
      target === 'all' ? (['backend', 'frontend'] as const) : ([target] as const);

    for (const runTarget of runTargets) {
      const cwd = path.join(fastify.projectRoot, runTarget);
      const packageJsonPath = path.join(cwd, 'package.json');

      // Check if package.json exists for this target
      if (!fs.existsSync(packageJsonPath)) {
        results.push({
          target: runTarget,
          code: -1,
          durationMs: 0,
          output: `[error] Cannot run ${runTarget} tests: package.json not found at ${packageJsonPath}\nTests are only available in development mode or when source files are present.`
        });
        continue;
      }

      const result = await runCommand(command, ['test'], cwd);
      results.push(result);
    }

    const success = results.every((result) => result.code === 0);

    return reply.send({
      success,
      results
    });
  });
};

export default testsRoutes;
