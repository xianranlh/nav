const test = require("node:test");
const assert = require("node:assert/strict");

const {
  collectStarredLinks,
  collectRecentLinks,
  recordLinkUsage,
  createGroupDraft,
  shouldShowGroupTabs,
  buildGroupTabItems,
} = require("../js/homepage-layout.js");

test("collects pinned links with their group metadata and a stable limit", () => {
  const groups = [
    {
      id: "dev",
      name: "开发",
      links: [
        { id: "a", name: "Docs", url: "https://docs.example", pinned: true },
        { id: "b", name: "Mail", url: "https://mail.example" },
      ],
    },
    {
      id: "life",
      name: "生活",
      links: [
        { id: "c", name: "Music", url: "https://music.example", pinned: true },
      ],
    },
  ];

  assert.deepEqual(
    collectStarredLinks(groups, 1),
    [{ id: "a", name: "Docs", url: "https://docs.example", pinned: true, groupId: "dev", groupName: "开发" }],
  );
});

test("collects up to twenty recent links newest first and keeps group metadata", () => {
  const links = Array.from({ length: 24 }, (_, index) => ({
    id: `link-${index}`,
    name: `Link ${index}`,
    lastClickAt: index + 1,
  }));
  const recent = collectRecentLinks([{ id: "local", name: "本机站点", links }]);

  assert.equal(recent.length, 20);
  assert.equal(recent[0].id, "link-23");
  assert.equal(recent[19].id, "link-4");
  assert.equal(recent[0].groupId, "local");
  assert.equal(recent[0].groupName, "本机站点");
});

test("records link usage with a monotonic click counter and timestamp", () => {
  const link = { id: "docs", clickCount: "2" };
  assert.equal(recordLinkUsage(link, 1234), link);
  assert.equal(link.clickCount, 3);
  assert.equal(link.lastClickAt, 1234);
  assert.equal(recordLinkUsage(null, 1234), null);
});

test("shows group tabs only when the homepage has enough groups", () => {
  assert.equal(shouldShowGroupTabs([{ id: "a" }, { id: "b" }, { id: "c" }]), false);
  assert.equal(shouldShowGroupTabs([{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }]), true);
});

test("builds lightweight tab view models", () => {
  assert.deepEqual(
    buildGroupTabItems([
      { id: "work", name: "工作" },
      { id: "fun", name: "" },
    ]),
    [
      { id: "work", label: "工作" },
      { id: "fun", label: "未命名分组" },
    ],
  );
});

test("creates an inline group draft with normalized fields", () => {
  assert.deepEqual(
    createGroupDraft({
      name: "  新资料  ",
      color: "",
      idFactory: () => "gid-1",
    }),
    {
      id: "gid-1",
      name: "新资料",
      color: "#f6a5c0",
      links: [],
    },
  );
});
