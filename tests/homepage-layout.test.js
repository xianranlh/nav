const test = require("node:test");
const assert = require("node:assert/strict");

const {
  collectStarredLinks,
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
