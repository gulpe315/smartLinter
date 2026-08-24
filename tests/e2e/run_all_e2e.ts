/**
 * SmartLinter Task 19: All E2E Integration Test Runner
 *
 * Orchestrates complete End-to-End verification across:
 * - MS Word Complete Workflow (tests/e2e/workflow_word.test.ts)
 * - Adobe InDesign Complete Workflow (tests/e2e/workflow_indesign.test.ts)
 *
 * Verifies:
 * 1. Pre-flight check for live Ollama (127.0.0.1:11434 / qwen2.5:7b)
 * 2. Scenario 1 (Default QA Cycle with TM & Live Ollama)
 * 3. Scenario 2 (Stale Conflict Auto-Rescan UX)
 * 4. Scenario 3 (Rollback & Fallback Safety Net)
 * 5. Scenario 4 (No-UI Background Persistence Loop)
 */

import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

async function checkOllamaHealth(host = 'http://127.0.0.1:11434'): Promise<{ isAlive: boolean; models: string[] }> {
    try {
        const res = await fetch(`${host}/api/tags`);
        if (!res.ok) return { isAlive: false, models: [] };
        const data = (await res.json()) as { models?: Array<{ name: string }> };
        const models = (data.models || []).map((m) => m.name);
        return { isAlive: true, models };
    } catch {
        return { isAlive: false, models: [] };
    }
}

async function main() {
    console.log('\n' + '='.repeat(70));
    console.log('  🚀 SmartLinter Task 19: Full E2E Integration Test Suite Runner');
    console.log('='.repeat(70) + '\n');

    // 1. Pre-flight Check: Live Ollama
    console.log('🔍 [Pre-flight] Checking Local Ollama Daemon Status...');
    const ollama = await checkOllamaHealth();
    if (ollama.isAlive) {
        console.log(`   ✅ Ollama is ALIVE at 127.0.0.1:11434`);
        console.log(`   📦 Available Models: ${ollama.models.join(', ') || 'none'}`);
        const hasQwen = ollama.models.some((m) => m.includes('qwen2.5:7b') || m.includes('qwen2.5'));
        if (hasQwen) {
            console.log(`   ✨ Target model 'qwen2.5:7b' detected ready for live QA inference\n`);
        } else {
            console.log(`   ⚠️ Target model 'qwen2.5:7b' not explicitly found in tags list, will attempt fallback\n`);
        }
    } else {
        console.log(`   ⚠️ Warning: Ollama daemon not reachable at 127.0.0.1:11434 (Live QA may fail or fallback)\n`);
    }

    const testFiles = [
        path.resolve(rootDir, 'tests/e2e/workflow_word.test.ts'),
        path.resolve(rootDir, 'tests/e2e/workflow_indesign.test.ts'),
    ];

    console.log('----------------------------------------------------------------------');
    console.log('▶ Executing Full E2E Test Suite (Word & InDesign Workflows)...');
    console.log('----------------------------------------------------------------------\n');

    const overallStartTime = performance.now();
    const result = spawnSync(
        'npx',
        ['tsx', '--test', ...testFiles],
        {
            cwd: rootDir,
            shell: true,
            stdio: 'inherit',
            env: { ...process.env, FORCE_COLOR: '1' },
        }
    );
    const overallDuration = performance.now() - overallStartTime;

    const exitCode = result.status ?? (result.error ? 1 : 0);

    console.log('\n' + '='.repeat(70));
    console.log('  📊 E2E Test Execution Summary Report');
    console.log('='.repeat(70));
    console.log(`  Total Execution Time : ${(overallDuration / 1000).toFixed(2)}s`);
    console.log(`  Overall Status       : ${exitCode === 0 ? '🎉 ALL E2E SUITES PASSED (100%)' : '❌ SOME E2E SUITES FAILED'}`);
    console.log('='.repeat(70) + '\n');

    process.exit(exitCode);
}

main().catch((err) => {
    console.error('Fatal runner exception:', err);
    process.exit(1);
});
