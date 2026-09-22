const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Exercise the real send controller with a delayed upstream, without a DOM or network.
function fixture() {
  const source = fs.readFileSync(require.resolve('../js/ui/ai-chat.ui.js'), 'utf8');
  const classes = { add() {}, remove() {}, toggle() {} };
  const input = { value: '第一个问题', dispatchEvent() {} };
  const provider = { id: 'p', models: ['model'], defaultModel: 'model' };
  const store = { messages: [], data: { currentModel: 'model' }, currentProvider: () => provider, saveMessages() {} };
  const calls = [];
  const context = {
    input, attachments: [], abortCtrl: null, panel: { dataset: {}, classList: classes },
    sendBtn: {}, stopBtn: {}, tipEl: { classList: classes },
    AbortController, Event, setTimeout: () => 0,
    scrollToBottom() {}, renderAttachments() {}, autoResize() {}, renderMessages() {},
    saveDraft() {}, syncComposer() {}, emitPetEvent() {}, refreshModelStatus() {}, toast() {},
    scheduleLastBubbleRender() {}, formatAIError: e => e.message,
    AI: {
      AIStore: store, upstreamMap: {}, cooldownLedger: {},
      rankModels: () => ({ fresh: ['model'], cold: [] }),
      buildMessages: async () => [], parseActions: () => [],
      isCooldownError: () => false, isGatewayError: () => false,
      chat: options => new Promise((resolve, reject) => {
        calls.push({ options, resolve, reject });
        options.signal.addEventListener('abort', () => {
          const error = new Error('aborted'); error.name = 'AbortError'; reject(error);
        });
      }),
    },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('    async function send() {'), source.indexOf('    function renderMessages() {')), context);
  return { context, input, store, calls, send: () => vm.runInContext('send()', context) };
}

test('a pending response cannot be submitted twice or consume the next draft', async () => {
  const f = fixture();
  const pending = f.send();
  await new Promise(setImmediate);
  f.input.value = '下一条草稿';
  await f.send();
  assert.equal(f.calls.length, 1);
  assert.equal(f.store.messages.length, 2);
  f.calls[0].options.onDelta('回答', '完整回答');
  f.calls[0].resolve();
  await pending;
  assert.equal(f.input.value, '下一条草稿');
  assert.equal(f.store.messages[1].content, '完整回答');
  assert.equal(f.store.messages[1].streaming, false);
  assert.equal(f.context.abortCtrl, null);
});

test('stopping retains partial output and does not turn cancellation into an error', async () => {
  const f = fixture();
  const pending = f.send();
  await new Promise(setImmediate);
  f.calls[0].options.onDelta('已生成的内容', '已生成的内容');
  f.context.abortCtrl.abort();
  await pending;
  assert.match(f.store.messages[1].content, /已生成的内容/);
  assert.match(f.store.messages[1].content, /已停止生成/);
  assert.equal(f.store.messages[1].cancelled, true);
  assert.equal(f.store.messages[1].error, undefined);
  assert.equal(f.context.stopBtn.hidden, true);
  assert.equal(f.context.sendBtn.hidden, false);
});

test('a session transition blocks sends until history is ready', async () => {
  const f = fixture();
  f.context.panel.dataset.sessionBusy = 'true';
  await f.send();
  assert.equal(f.store.messages.length, 0);
  assert.equal(f.input.value, '第一个问题');
});
