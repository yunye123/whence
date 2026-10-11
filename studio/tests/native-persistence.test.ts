import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import { rmdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VideoImportService } from '../native/video-import-service';
import type { DownloadOptions } from '../native/download';

const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) { assert.ok(Date.now() < deadline, 'task did not reach expected state'); await delay(10); }
}
async function fixture() {
  const base = path.resolve(os.tmpdir());
  const directory = await fs.mkdtemp(path.join(base, 'field-native-persistence-'));
  return { directory, async clean() {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), base); assert.ok(path.basename(resolved).startsWith('field-native-persistence-'));
    await fs.rm(resolved, { recursive: true, force: true });
  } };
}

test('a throttled disk write failure remains a failure after its worker aborts', async context => {
  const logged: unknown[][] = [];
  context.mock.method(console, 'error', (...args: unknown[]) => { logged.push(args); });
  const temporary = await fixture(); let downloading = false;
  const nextFile = path.join(temporary.directory, 'import-tasks.json.next');
  const service = await VideoImportService.open({ directory: temporary.directory,
    download: async (_url: string, _project: string, options: DownloadOptions = {}): Promise<never> => {
      await fs.mkdir(nextFile); downloading = true;
      options.onProgress?.(5, 'controlled progress triggering a throttled save');
      return new Promise((_resolve, reject) => options.signal!.addEventListener('abort', () => {
        // Recover the disk before rejection, reproducing the former incorrect "cancelled" overwrite.
        rmdirSync(nextFile); reject(options.signal!.reason);
      }, { once: true }));
    },
  });
  try {
    const submitted = service.submit({ url: 'https://example.com/controlled.mp4', boardId: 'board', nodeId: 'node' });
    await waitFor(() => downloading && !service.hasActiveTasks);
    const task = service.list().find(item => item.id === submitted.id)!;
    assert.equal(task.status, 'failed'); assert.match(task.message, /本机任务保存失败/);
    assert.ok(task.error); assert.equal(task.assetId, undefined);
    assert.match(String(logged[0]?.[0]), /队列保存失败/);
  } finally { await service.close(); await temporary.clean(); }
});

test('concurrent close callers await the same worker cleanup promise', async () => {
  const temporary = await fixture(); let downloading = false; let stopped = false;
  const service = await VideoImportService.open({ directory: temporary.directory,
    download: async (_url: string, _project: string, options: DownloadOptions = {}): Promise<never> => {
      downloading = true;
      return new Promise((_resolve, reject) => options.signal!.addEventListener('abort', () => {
        setTimeout(() => { stopped = true; reject(options.signal!.reason); }, 50);
      }, { once: true }));
    },
  });
  try {
    service.submit({ url: 'https://example.com/controlled.mp4', boardId: 'board', nodeId: 'node' });
    await waitFor(() => downloading);
    const first = service.close(), second = service.close();
    assert.equal(first, second); assert.equal(stopped, false);
    await second; assert.equal(stopped, true);
    const saved = JSON.parse(await fs.readFile(path.join(temporary.directory, 'import-tasks.json'), 'utf8'));
    assert.equal(saved.tasks[0].status, 'interrupted');
  } finally { await service.close(); await temporary.clean(); }
});

test('persistent task-file failure still permits worker cleanup and desktop close', async context => {
  context.mock.method(console, 'error', () => {});
  const temporary = await fixture(); let downloading = false; let stopped = false;
  const service = await VideoImportService.open({ directory: temporary.directory,
    download: async (_url: string, _project: string, options: DownloadOptions = {}): Promise<never> => {
      downloading = true;
      return new Promise((_resolve, reject) => options.signal!.addEventListener('abort', () => {
        stopped = true; reject(options.signal!.reason);
      }, { once: true }));
    },
  });
  try {
    service.submit({ url: 'https://example.com/controlled.mp4', boardId: 'board', nodeId: 'node' });
    await waitFor(() => downloading);
    await fs.mkdir(path.join(temporary.directory, 'import-tasks.json.next'));
    await assert.doesNotReject(service.close()); assert.equal(stopped, true);
    assert.equal(service.hasActiveTasks, false); assert.equal(service.list()[0].status, 'failed');
  } finally { await service.close(); await temporary.clean(); }
});
