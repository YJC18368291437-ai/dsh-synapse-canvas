const app = document.querySelector('#app')
if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
const LEGACY_CARD_POSITIONS_KEY = 'dsh-synapse:card-positions'
const CARD_POSITIONS_KEY = 'dsh-synapse:card-positions:v3'
const COLLAPSED_CARDS_KEY = 'dsh-synapse:collapsed-cards:v1'
const QUICK_PHRASES_KEY = 'dsh-synapse:quick-phrases:v1'
const DEFAULT_QUICK_PHRASES = ['展开说明', '举例', '通俗易懂', '对比解释']
const MAX_QUICK_PHRASES = 12
const MAX_QUICK_PHRASE_LENGTH = 16
function normalizeQuickPhrases(value) {
  if (!Array.isArray(value)) return []
  const phrases = []
  for (const item of value) {
    const phrase = typeof item === 'string' ? item.trim().slice(0, MAX_QUICK_PHRASE_LENGTH) : ''
    if (phrase !== '' && !phrases.includes(phrase)) phrases.push(phrase)
    if (phrases.length === MAX_QUICK_PHRASES) break
  }
  return phrases
}
const savedQuickPhrases = (() => {
  try {
    const stored = localStorage.getItem(QUICK_PHRASES_KEY)
    return stored === null ? DEFAULT_QUICK_PHRASES : normalizeQuickPhrases(JSON.parse(stored))
  } catch { return DEFAULT_QUICK_PHRASES }
})()
const savedBranchAnchors = (() => {
  try {
    const value = JSON.parse(localStorage.getItem('dsh-synapse:branch-anchors') ?? '[]')
    return Array.isArray(value) ? value.filter(item => Array.isArray(item) && typeof item[0] === 'string' && typeof item[1] === 'string') : []
  } catch { return [] }
})()
const savedCardPositions = (() => {
  try {
    // Drop formats that were never persisted; the current key stores drags.
    localStorage.removeItem(LEGACY_CARD_POSITIONS_KEY)
    localStorage.removeItem('dsh-synapse:card-positions:v2')
    const value = JSON.parse(localStorage.getItem(CARD_POSITIONS_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter(item => Array.isArray(item) && typeof item[0] === 'string' && item[1] !== null && Number.isFinite(item[1].x) && Number.isFinite(item[1].y)) : []
  } catch { return [] }
})()
const savedCollapsedCards = (() => {
  try {
    const value = JSON.parse(localStorage.getItem(COLLAPSED_CARDS_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter(item => typeof item === 'string') : []
  } catch { return [] }
})()
// User-drawn canvas links, Obsidian-style. `custom` lists edges the user added
// by hand; `removed` lists auto-derived branch edges the user hid. Both are
// keyed `from>to` on card ids (thread id + turn), which stay stable across
// reloads, so the canvas remembers the wiring like it remembers card drags.
const EDGES_KEY = 'dsh-synapse:edges:v1'
const edgeKey = (from, to) => `${from}>${to}`
const isEdgePair = value => Array.isArray(value) && typeof value[0] === 'string' && typeof value[1] === 'string'
const savedEdges = (() => {
  try {
    const value = JSON.parse(localStorage.getItem(EDGES_KEY) ?? '{}')
    const sides = new Map()
    if (Array.isArray(value.sides)) for (const pair of value.sides) {
      if (!Array.isArray(pair) || typeof pair[0] !== 'string' || pair[1] === null || typeof pair[1] !== 'object') continue
      sides.set(pair[0], { fromSide: pair[1].fromSide === 'left' ? 'left' : 'right', toSide: pair[1].toSide === 'left' ? 'left' : 'right' })
    }
    return {
      custom: Array.isArray(value.custom) ? value.custom.filter(isEdgePair) : [],
      removed: Array.isArray(value.removed) ? value.removed.filter(isEdgePair) : [],
      sides,
    }
  } catch { return { custom: [], removed: [], sides: new Map() } }
})()
// Cards the user hid from the canvas. Stored as [id, question] pairs so the
// "已隐藏卡片" list can show a label and restore them even before the card is
// projected again.
const HIDDEN_CARDS_KEY = 'dsh-synapse:hidden-cards:v1'
const savedHiddenCards = (() => {
  try {
    const value = JSON.parse(localStorage.getItem(HIDDEN_CARDS_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter(item => Array.isArray(item) && typeof item[0] === 'string') : []
  } catch { return [] }
})()
// Cards the user pinned with the lock toggle on the card head. Locked cards
// keep their exact spot through 一键整理; everything else re-flows around them.
const LOCKED_CARDS_KEY = 'dsh-synapse:locked-cards:v1'
const savedLockedCards = (() => {
  try {
    const value = JSON.parse(localStorage.getItem(LOCKED_CARDS_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter(item => typeof item === 'string') : []
  } catch { return [] }
})()
// Per-card display titles (model-generated or hand-renamed). Wired into both
// the canvas and the undo history now; the title feature fills them in.
const CARD_TITLES_KEY = 'dsh-synapse:card-titles:v1'
const savedCardTitles = (() => {
  try {
    const value = JSON.parse(localStorage.getItem(CARD_TITLES_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter(item => Array.isArray(item) && typeof item[0] === 'string' && typeof item[1] === 'string') : []
  } catch { return [] }
})()
// Card folders: a nested tree of named collections. `folders` holds folder
// nodes (name, parent, spot on its parent canvas); `folderCards` maps a folder
// to the card keys it contains (card keys are stable per-turn position keys).
const FOLDERS_KEY = 'dsh-synapse:folders:v1'
const savedFolderState = (() => {
  try {
    const value = JSON.parse(localStorage.getItem(FOLDERS_KEY) ?? '{}')
    const folders = new Map()
    if (Array.isArray(value.folders)) for (const folder of value.folders) {
      if (folder === null || typeof folder !== 'object' || typeof folder.id !== 'string') continue
      folders.set(folder.id, {
        id: folder.id,
        name: typeof folder.name === 'string' && folder.name.trim() !== '' ? folder.name : '文件夹',
        parentId: typeof folder.parentId === 'string' ? folder.parentId : null,
        position: folder.position !== null && typeof folder.position === 'object' && Number.isFinite(folder.position.x) && Number.isFinite(folder.position.y)
          ? { x: folder.position.x, y: folder.position.y }
          : { x: 86, y: 82 },
      })
    }
    const members = new Map()
    if (Array.isArray(value.members)) for (const pair of value.members) {
      if (!Array.isArray(pair) || typeof pair[0] !== 'string' || !Array.isArray(pair[1])) continue
      members.set(pair[0], new Set(pair[1].filter(key => typeof key === 'string')))
    }
    return { folders, members }
  } catch { return { folders: new Map(), members: new Map() } }
})()
// Locked groups: Alt+marquee freezes the relative positions of the selected
// cards and folders so they move (and are arranged) as one rigid block.
const LOCK_GROUPS_KEY = 'dsh-synapse:lock-groups:v1'
const savedLockGroups = (() => {
  try {
    const value = JSON.parse(localStorage.getItem(LOCK_GROUPS_KEY) ?? '[]')
    return Array.isArray(value) ? value.map(entry => Array.isArray(entry) ? entry.filter(key => typeof key === 'string') : []).filter(keys => keys.length > 0) : []
  } catch { return [] }
})()
// Right-hand card inspector width, drag-resizable and remembered.
const INSPECTOR_WIDTH_KEY = 'dsh-synapse:inspector-width'
const savedInspectorWidth = (() => {
  try { const v = Number(localStorage.getItem(INSPECTOR_WIDTH_KEY)); return Number.isFinite(v) && v >= 240 ? Math.round(v) : 0 } catch { return 0 }
})()
const CARD_WIDTH = 310
const CARD_HEIGHT = 276
const CARD_GAP_Y = 42
const CAMERA_INSET_X = 56
const CAMERA_INSET_Y = 56
// Cards outside the viewport (plus this world-space margin) are not mounted
// into the DOM; the margin pre-mounts cards just before they scroll into view
// so panning never flashes empty space.
const VIEWPORT_MARGIN = 1400
const state = {
  summaries: [], workspace: null, activeId: null, selectedCardId: null, mode: 'canvas', zoom: 1, currentDsh: null, sidebarCollapsed: false,
  dshWorkspaces: [], selectedDshWorkspaceId: null,
  historyBySession: new Map(), historyRequests: new Map(), pendingReplies: new Map(), pendingRpc: new Map(), liveReplies: new Map(),
  draft: null, error: '', workspaceLoad: 0, branchAnchors: new Map(savedBranchAnchors), cardPositions: new Map(savedCardPositions), collapsedCardIds: new Set(savedCollapsedCards), quickPhrases: savedQuickPhrases, quickPhraseEditorOpen: false,
  customEdges: new Set(savedEdges.custom.map(pair => edgeKey(pair[0], pair[1]))), removedEdges: new Set(savedEdges.removed.map(pair => edgeKey(pair[0], pair[1]))),
  edgeSides: new Map(savedEdges.sides),
  hiddenCards: new Map(savedHiddenCards.map(pair => [pair[0], { question: typeof pair[1] === 'string' ? pair[1] : '' }])),
  lockedCards: new Set(savedLockedCards),
  lockGroups: savedLockGroups.map(keys => new Set(keys)),
  cardTitles: new Map(savedCardTitles),
  folders: new Map(savedFolderState.folders), folderCards: new Map([...savedFolderState.members].map(([id, keys]) => [id, new Set(keys)])), viewFolderId: null,
  dragging: false, canvasGesture: false, canvasRefreshAfter: 0, canvasViewInitialized: false, canvasCamera: { x: 0, y: 0 }, mapCardSessionSwitches: new Set(),
  expandedMessageIds: new Set(),
  canvasCards: undefined, canvasCardsById: undefined, canvasGraph: undefined, mountedCardIds: new Set(), canvasNeedsCenter: false, canvasNeedsFit: false, mapOpenedOnce: false,
  canvasFolders: [], canvasContext: [], canvasContextFolders: [], viewNodesById: new Map(), viewEdges: [],
  detailScrollByThread: new Map(), detailThreadId: null, detailTargetCardId: null,
  inspectorCardId: null, inspectorOpening: false, inspectorScrollByCard: new Map(), inspectorWidth: savedInspectorWidth,
  selectedCardIds: new Set(), selectedFolderIds: new Set(), hiddenPanelOpen: false,
}

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))
const formatTime = value => new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const currentThread = () => state.workspace?.threads.find(thread => thread.id === state.activeId) ?? state.workspace?.threads[0] ?? null
const threadListTitle = thread => thread.dshSessionTitle ?? thread.title ?? questionFor(thread)

function rememberBranchAnchor(sessionId, cardId) {
  state.branchAnchors.set(sessionId, cardId)
  try { localStorage.setItem('dsh-synapse:branch-anchors', JSON.stringify([...state.branchAnchors])) } catch { /* Private browsing may disable local storage. */ }
}

function persistCardPositions() {
  try { localStorage.setItem(CARD_POSITIONS_KEY, JSON.stringify([...state.cardPositions])) } catch { /* Private browsing may disable local storage. */ }
}

function persistInspectorWidth() {
  try { if (state.inspectorWidth > 0) localStorage.setItem(INSPECTOR_WIDTH_KEY, String(state.inspectorWidth)) } catch { /* Private browsing may disable local storage. */ }
}

function persistEdges() {
  try {
    localStorage.setItem(EDGES_KEY, JSON.stringify({
      custom: [...state.customEdges].map(key => key.split('>')),
      removed: [...state.removedEdges].map(key => key.split('>')),
      sides: [...state.edgeSides].map(([key, value]) => [key, value]),
    }))
  } catch { /* Private browsing may disable local storage. */ }
}

// Wire two cards together by hand. Drawing over a hidden auto edge restores it
// instead of stacking a duplicate custom edge on top of the same pair.
function connectCards(fromId, toId, fromSide = 'right') {
  if (fromId === toId) return
  const key = edgeKey(fromId, toId)
  if (state.customEdges.has(key)) return
  const fromCard = state.canvasCardsById?.get(fromId)
  const toCard = state.canvasCardsById?.get(toId)
  const isAuto = fromCard !== undefined && toCard !== undefined && toCard.parentId === fromId
  if (isAuto && !state.removedEdges.has(key)) return
  pushHistory()
  if (isAuto) {
    state.removedEdges.delete(key)
  } else {
    state.customEdges.add(key)
    state.edgeSides.set(key, { fromSide, toSide: fromSide === 'left' ? 'right' : 'left' })
  }
  persistEdges()
  render()
}

function removeEdge(key) {
  if (state.customEdges.has(key)) {
    pushHistory()
    state.customEdges.delete(key)
  } else {
    if (!window.confirm('消除这条自动生成的连线？该会话的分支关系仍会保留，只是画布上不再显示。')) return
    pushHistory()
    state.removedEdges.add(key)
  }
  state.edgeSides.delete(key)
  persistEdges()
  render()
}

// Delete every underlying link that a rendered canvas line stands for.
function removeEdgeKeys(keys) {
  const hasAuto = keys.some(key => !state.customEdges.has(key))
  if (hasAuto && !window.confirm('删除这条连线？该会话的分支关系仍会保留。')) return
  pushHistory()
  for (const key of keys) {
    if (state.customEdges.has(key)) state.customEdges.delete(key)
    else state.removedEdges.add(key)
    state.edgeSides.delete(key)
  }
  persistEdges()
  render()
}

function persistHiddenCards() {
  try {
    localStorage.setItem(HIDDEN_CARDS_KEY, JSON.stringify([...state.hiddenCards].map(([id, info]) => [id, info.question])))
  } catch { /* Private browsing may disable local storage. */ }
}

function hideCard(cardId) {
  const card = state.canvasCardsById?.get(cardId)
  pushHistory()
  state.hiddenCards.set(cardId, { question: typeof card?.question === 'string' ? card.question : '' })
  if (state.selectedCardId === cardId) state.selectedCardId = null
  if (state.inspectorCardId === cardId) { state.inspectorCardId = null; state.inspectorOpening = false }
  persistHiddenCards()
  render()
}

function restoreCard(cardId) {
  if (!state.hiddenCards.has(cardId)) return
  pushHistory()
  state.hiddenCards.delete(cardId)
  persistHiddenCards()
  render()
}

function persistLockedCards() {
  try { localStorage.setItem(LOCKED_CARDS_KEY, JSON.stringify([...state.lockedCards])) } catch { /* Private browsing may disable local storage. */ }
}

// Lock pins a card's current spot so 一键整理 leaves it alone. Locking also
// snapshots the position immediately, so even ordinary relayouts respect it.
function toggleCardLock(cardId) {
  const card = state.canvasCardsById?.get(cardId)
  pushHistory()
  if (state.lockedCards.has(cardId)) {
    state.lockedCards.delete(cardId)
    state.cardPositions.delete(cardId)
    if (typeof card?.positionKey === 'string') state.cardPositions.delete(card.positionKey)
    persistCardPositions()
  } else {
    state.lockedCards.add(cardId)
    if (card !== undefined) {
      const position = { x: Math.round(card.position.x), y: Math.round(card.position.y) }
      state.cardPositions.set(cardId, position)
      if (typeof card.positionKey === 'string') state.cardPositions.set(card.positionKey, position)
      persistCardPositions()
    }
  }
  persistLockedCards()
  render()
}

function persistCardTitles() {
  try { localStorage.setItem(CARD_TITLES_KEY, JSON.stringify([...state.cardTitles])) } catch { /* Private browsing may disable local storage. */ }
}

function persistFolders() {
  try {
    localStorage.setItem(FOLDERS_KEY, JSON.stringify({
      folders: [...state.folders.values()],
      members: [...state.folderCards].map(([id, keys]) => [id, [...keys]]),
    }))
  } catch { /* Private browsing may disable local storage. */ }
}

function persistLockGroups() {
  try { localStorage.setItem(LOCK_GROUPS_KEY, JSON.stringify(state.lockGroups.map(group => [...group]))) } catch { /* Private browsing may disable local storage. */ }
}

function lockGroupOf(key) {
  for (const group of state.lockGroups) if (group.has(key)) return group
  return null
}

// Members that move together when `key` is dragged: its lock group (cards and
// folders), or just this item.
function selectionDragMembers() {
  const members = []
  for (const card of state.canvasCards ?? []) {
    if (!state.selectedCardIds.has(card.id)) continue
    const element = app.querySelector(`.thread-card[data-card-id="${selectorValue(card.id)}"]`)
    members.push({ kind: 'card', id: card.id, ref: card, element, initial: { ...card.position } })
  }
  for (const folder of state.canvasFolders ?? []) {
    if (!state.selectedFolderIds.has(folder.id)) continue
    const element = app.querySelector(`.folder-card[data-folder-id="${selectorValue(folder.id)}"]`)
    members.push({ kind: 'folder', id: folder.id, ref: folder, element, initial: { ...folder.position } })
  }
  return members
}

function dragMembersFor(key) {
  const group = lockGroupOf(key)
  const keys = group !== null ? [...group] : [key]
  const members = []
  for (const memberKey of keys) {
    if (memberKey.startsWith('folder:')) {
      const folderId = memberKey.slice(7)
      const folder = state.folders.get(folderId)
      if (folder === undefined || folder.parentId !== state.viewFolderId) continue
      const element = app.querySelector(`.folder-card[data-folder-id="${selectorValue(folderId)}"]`)
      members.push({ kind: 'folder', id: folderId, ref: folder, element, initial: { ...folder.position } })
      continue
    }
    const card = (state.canvasCards ?? []).find(item => cardKeyOf(item) === memberKey)
    if (card === undefined) continue
    const element = app.querySelector(`.thread-card[data-card-id="${selectorValue(card.id)}"]`)
    members.push({ kind: 'card', id: card.id, ref: card, element, initial: { ...card.position } })
  }
  return members
}

// Alt + marquee: freeze the selected cards/folders' relative positions. Doing
// it again on the same group releases it.
function lockSelection(cardIds, folderIds) {
  const keys = new Set()
  for (const card of state.canvasCards ?? []) if (cardIds.has(card.id)) keys.add(cardKeyOf(card))
  for (const id of folderIds) if (state.folders.has(id)) keys.add(`folder:${id}`)
  if (keys.size === 0) return
  const firstGroup = lockGroupOf([...keys][0])
  if (firstGroup !== null && [...keys].every(key => firstGroup.has(key))) {
    pushHistory()
    state.lockGroups = state.lockGroups.filter(group => group !== firstGroup)
  } else {
    if (keys.size < 2) return
    pushHistory()
    for (const group of state.lockGroups) for (const key of keys) group.delete(key)
    state.lockGroups = state.lockGroups.filter(group => group.size > 0)
    state.lockGroups.push(keys)
  }
  persistLockGroups()
  state.selectedCardIds = new Set()
  state.selectedFolderIds = new Set()
  render()
}

const cardKeyOf = card => card.positionKey ?? card.id
function containerOfCardKey(key) {
  for (const [folderId, keys] of state.folderCards) if (keys.has(key)) return folderId
  return null
}

function childFoldersOf(folderId) {
  return [...state.folders.values()].filter(folder => folder.parentId === folderId)
}

function topLevelFolderId(folderId) {
  let current = folderId
  const seen = new Set()
  while (current !== null && state.folders.has(current) && !seen.has(current)) {
    seen.add(current)
    const parent = state.folders.get(current).parentId
    if (parent === null) return current
    current = parent
  }
  return folderId
}

// The folder on `containerId`'s ancestor chain that is a direct child of the
// current view (null = main canvas), or null when it lies outside the view.
function folderChildOfView(containerId, viewFolderId) {
  let current = containerId
  const seen = new Set()
  while (current !== null && state.folders.has(current) && !seen.has(current)) {
    seen.add(current)
    const parent = state.folders.get(current).parentId
    if (parent === viewFolderId) return current
    current = parent
  }
  return null
}

function folderDepth(folderId) {
  let depth = 0
  let current = state.folders.get(folderId)?.parentId ?? null
  const seen = new Set()
  while (current !== null && state.folders.has(current) && !seen.has(current)) {
    seen.add(current)
    depth += 1
    current = state.folders.get(current).parentId
  }
  return depth
}

function addKeyToCurrentFolder(key) {
  if (state.viewFolderId === null) return
  const members = state.folderCards.get(state.viewFolderId) ?? new Set()
  members.add(key)
  state.folderCards.set(state.viewFolderId, members)
  persistFolders()
}

// Tab + marquee: collect the selected cards AND folders into a new named
// folder (selected folders become sub-folders).
function createFolderFromSelection(ids, folderIds = new Set()) {
  const cards = (state.canvasCards ?? []).filter(card => ids.has(card.id))
  const childFolderIds = [...folderIds].filter(id => state.folders.has(id))
  if (cards.length === 0 && childFolderIds.length === 0) return
  const entered = window.prompt('文件夹名称', '新建文件夹')
  if (entered === null) return
  const name = entered.trim() === '' ? '文件夹' : entered.trim().slice(0, 40)
  const points = [...cards.map(card => card.position), ...childFolderIds.map(id => state.folders.get(id).position)]
  const origin = points.reduce((min, point) => ({ x: Math.min(min.x, point.x), y: Math.min(min.y, point.y) }), { x: Infinity, y: Infinity })
  const folderId = crypto.randomUUID()
  pushHistory()
  state.folders.set(folderId, {
    id: folderId,
    name,
    parentId: state.viewFolderId,
    position: { x: Number.isFinite(origin.x) ? origin.x : 86, y: Number.isFinite(origin.y) ? origin.y : 82 },
  })
  state.folderCards.set(folderId, new Set(cards.map(cardKeyOf)))
  for (const childId of childFolderIds) {
    if (childId === folderId || isFolderAncestor(childId, folderId)) continue
    const child = state.folders.get(childId)
    if (child === undefined) continue
    child.parentId = folderId
  }
  persistFolders()
  state.selectedCardIds = new Set()
  state.selectedFolderIds = new Set()
  render()
}

// Move one card out of its folder to the folder's parent canvas.
function moveCardOut(cardId) {
  const card = state.canvasCardsById?.get(cardId)
  if (card === undefined) return
  const key = cardKeyOf(card)
  const container = containerOfCardKey(key)
  if (container === null) return
  pushHistory()
  state.folderCards.get(container)?.delete(key)
  const parentId = state.folders.get(container)?.parentId ?? null
  if (parentId !== null) {
    const parentMembers = state.folderCards.get(parentId) ?? new Set()
    parentMembers.add(key)
    state.folderCards.set(parentId, parentMembers)
  }
  persistFolders()
  render()
}

// Move dragged cards/folders into `folderId` (drop a card onto a folder card).
function fileItems(members, folderId) {
  if (!state.folders.has(folderId)) return false
  let changed = false
  for (const member of members) {
    if (member.kind === 'folder') {
      const child = state.folders.get(member.id)
      if (child === undefined || child.id === folderId || child.parentId === folderId) continue
      if (isFolderAncestor(member.id, folderId)) continue
      child.parentId = folderId
      child.position = { x: 86, y: 82 }
      changed = true
    } else {
      const key = member.ref ? cardKeyOf(member.ref) : member.id
      const current = containerOfCardKey(key)
      if (current === folderId) continue
      if (current !== null) state.folderCards.get(current)?.delete(key)
      const keys = state.folderCards.get(folderId) ?? new Set()
      keys.add(key)
      state.folderCards.set(folderId, keys)
      changed = true
    }
  }
  if (changed) persistFolders()
  return changed
}

function dissolveFolder(folderId) {
  const folder = state.folders.get(folderId)
  if (folder === undefined) return
  if (!window.confirm(`解散文件夹「${folder.name}」？里面的卡片会回到上一层，不会被删除。`)) return
  pushHistory()
  const parentId = folder.parentId
  const members = state.folderCards.get(folderId)
  if (members !== undefined) {
    if (parentId !== null) {
      const parentMembers = state.folderCards.get(parentId) ?? new Set()
      for (const key of members) parentMembers.add(key)
      state.folderCards.set(parentId, parentMembers)
    }
    state.folderCards.delete(folderId)
  }
  for (const child of state.folders.values()) if (child.parentId === folderId) child.parentId = parentId
  state.folders.delete(folderId)
  if (state.viewFolderId === folderId) state.viewFolderId = parentId
  persistFolders()
  render()
}

// Undo / redo over the canvas-local state (positions, links, hidden, locks,
// titles, collapsed subtrees). DSH-side actions such as archiving a session are
// not undoable because they live on the server.
const canvasHistory = { past: [], future: [] }
const HISTORY_LIMIT = 100

function snapshotCanvasState() {
  return {
    cardPositions: new Map(state.cardPositions),
    customEdges: new Set(state.customEdges),
    removedEdges: new Set(state.removedEdges),
    edgeSides: new Map(state.edgeSides),
    hiddenCards: new Map(state.hiddenCards),
    lockedCards: new Set(state.lockedCards),
    cardTitles: new Map(state.cardTitles),
    collapsedCardIds: new Set(state.collapsedCardIds),
    folders: new Map([...state.folders].map(([id, folder]) => [id, { ...folder, position: { ...folder.position } }])),
    folderCards: new Map([...state.folderCards].map(([id, keys]) => [id, new Set(keys)])),
    quickPhrases: [...state.quickPhrases],
    lockGroups: state.lockGroups.map(group => new Set(group)),
    viewFolderId: state.viewFolderId,
  }
}

function applyCanvasSnapshot(snapshot) {
  state.cardPositions = new Map(snapshot.cardPositions)
  state.customEdges = new Set(snapshot.customEdges)
  state.removedEdges = new Set(snapshot.removedEdges)
  state.edgeSides = new Map(snapshot.edgeSides ?? [])
  state.hiddenCards = new Map(snapshot.hiddenCards)
  state.lockedCards = new Set(snapshot.lockedCards)
  state.cardTitles = new Map(snapshot.cardTitles)
  state.collapsedCardIds = new Set(snapshot.collapsedCardIds)
  state.folders = new Map([...(snapshot.folders ?? [])].map(([id, folder]) => [id, { ...folder, position: { ...folder.position } }]))
  state.folderCards = new Map([...(snapshot.folderCards ?? [])].map(([id, keys]) => [id, new Set(keys)]))
  if (Array.isArray(snapshot.quickPhrases)) state.quickPhrases = [...snapshot.quickPhrases]
  state.lockGroups = (snapshot.lockGroups ?? []).map(group => new Set(group))
  state.viewFolderId = snapshot.viewFolderId ?? null
  state.selectedCardIds = new Set()
  state.selectedFolderIds = new Set()
  persistCardPositions()
  persistEdges()
  persistHiddenCards()
  persistLockedCards()
  persistCardTitles()
  persistCollapsedCards()
  persistFolders()
  persistQuickPhrases()
  persistLockGroups()
}

function pushHistory() {
  canvasHistory.past.push(snapshotCanvasState())
  if (canvasHistory.past.length > HISTORY_LIMIT) canvasHistory.past.shift()
  canvasHistory.future.length = 0
}

function undoCanvas() {
  if (canvasHistory.past.length === 0) return
  canvasHistory.future.push(snapshotCanvasState())
  applyCanvasSnapshot(canvasHistory.past.pop())
  render()
}

function redoCanvas() {
  if (canvasHistory.future.length === 0) return
  canvasHistory.past.push(snapshotCanvasState())
  applyCanvasSnapshot(canvasHistory.future.pop())
  render()
}

// ---- Custom keyboard shortcuts -------------------------------------------------
// Right-click any button and press a key to bind it. Bindings are stored in
// localStorage and fire the matching button when the key is pressed.
const SHORTCUTS_KEY = 'dsh-synapse:shortcuts:v1'
const shortcuts = (() => {
  try {
    const value = JSON.parse(localStorage.getItem(SHORTCUTS_KEY) ?? '{}')
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {}
  } catch { return {} }
})()

function persistShortcuts() {
  try { localStorage.setItem(SHORTCUTS_KEY, JSON.stringify(shortcuts)) } catch { /* Private browsing may disable local storage. */ }
}

function shortcutKeyFromEvent(event) {
  if (typeof event.key !== 'string' || event.key === '') return null
  const key = event.key.toLowerCase()
  if (['control', 'shift', 'alt', 'meta'].includes(key)) return null
  const parts = []
  if (event.ctrlKey) parts.push('ctrl')
  if (event.altKey) parts.push('alt')
  if (event.shiftKey) parts.push('shift')
  if (event.metaKey) parts.push('meta')
  parts.push(key)
  return parts.join('+')
}

const buttonSignature = button => [button.dataset.action ?? '', button.dataset.card ?? '', button.dataset.thread ?? ''].join('|')

function bindShortcut(combo, signature) {
  for (const key of Object.keys(shortcuts)) if (shortcuts[key] === signature) delete shortcuts[key]
  shortcuts[combo] = signature
  persistShortcuts()
}

function clearShortcut(signature) {
  let changed = false
  for (const key of Object.keys(shortcuts)) if (shortcuts[key] === signature) { delete shortcuts[key]; changed = true }
  if (changed) persistShortcuts()
}

function triggerShortcut(signature) {
  const [action, card, thread] = signature.split('|')
  let selector = `[data-action="${CSS.escape(action)}"]`
  if (card !== '') selector += `[data-card="${CSS.escape(card)}"]`
  if (thread !== '') selector += `[data-thread="${CSS.escape(thread)}"]`
  const button = document.querySelector(selector)
  if (button instanceof HTMLElement && !button.disabled) button.click()
}

let shortcutCapture = null
let shortcutHintTimer = 0

function shortcutHint(text, autoHide = false) {
  let element = document.querySelector('.shortcut-hint')
  if (!(element instanceof HTMLElement)) {
    element = document.createElement('div')
    element.className = 'shortcut-hint'
    document.body.appendChild(element)
  }
  element.textContent = text
  element.hidden = false
  if (shortcutHintTimer !== 0) window.clearTimeout(shortcutHintTimer)
  shortcutHintTimer = autoHide ? window.setTimeout(() => { shortcutHintTimer = 0; element.hidden = true }, 1800) : 0
}

function hideShortcutHint() {
  const element = document.querySelector('.shortcut-hint')
  if (element instanceof HTMLElement) element.hidden = true
}

// Surface bound shortcuts in the button tooltips after every render.
function applyShortcutTitles() {
  for (const button of document.querySelectorAll('[data-action]')) {
    if (!(button instanceof HTMLElement)) continue
    const signature = buttonSignature(button)
    const combo = Object.keys(shortcuts).find(key => shortcuts[key] === signature)
    if (combo === undefined) continue
    if (button.dataset.baseTitle === undefined) button.dataset.baseTitle = button.title
    button.title = `${button.dataset.baseTitle}（快捷键：${combo}）`
  }
}

function persistCollapsedCards() {
  try { localStorage.setItem(COLLAPSED_CARDS_KEY, JSON.stringify([...state.collapsedCardIds])) } catch { /* Private browsing may disable local storage. */ }
}

function persistQuickPhrases() {
  try { localStorage.setItem(QUICK_PHRASES_KEY, JSON.stringify(state.quickPhrases)) } catch { /* Private browsing may disable local storage. */ }
}

function rememberCardPosition(cardId, position, aliases = []) {
  state.cardPositions.set(cardId, { x: Math.round(position.x), y: Math.round(position.y) })
  for (const alias of aliases) state.cardPositions.set(alias, { x: Math.round(position.x), y: Math.round(position.y) })
  persistCardPositions()
}

function resetCardPositions() {
  state.cardPositions.clear()
  persistCardPositions()
  try {
    localStorage.removeItem(LEGACY_CARD_POSITIONS_KEY)
    localStorage.removeItem('dsh-synapse:card-positions:v2')
  } catch { /* Private browsing may disable local storage. */ }
}

function resetCanvasCamera() {
  state.canvasViewInitialized = false
  state.canvasCamera = { x: 0, y: 0 }
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers ?? {}) } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error ?? '请求失败')
  return body
}

function post(type, payload = {}) {
  if (window.parent !== window) window.parent.postMessage({ source: 'dsh-synapse', type, ...payload }, window.location.origin)
}

function dshRpc(type, payload = {}) {
  if (window.parent === window) return Promise.reject(new Error('请从 DSH 页面打开 Synapse 后再操作会话'))
  const requestId = crypto.randomUUID()
  post(type, { requestId, ...payload })
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      state.pendingRpc.delete(requestId)
      reject(new Error('DSH 未在规定时间内响应'))
    }, 20_000)
    state.pendingRpc.set(requestId, { resolve, reject, timer })
  })
}

function settleRpc(requestId, value, error) {
  const pending = state.pendingRpc.get(requestId)
  if (pending === undefined) return
  state.pendingRpc.delete(requestId)
  window.clearTimeout(pending.timer)
  if (error === undefined) pending.resolve(value)
  else pending.reject(error instanceof Error ? error : new Error(String(error)))
}

function setError(error = '') { state.error = error instanceof Error ? error.message : error; render() }

function messagesFromEvents(events) {
  if (!Array.isArray(events)) return []
  return events.flatMap(event => {
    const content = event?.data?.message?.content ?? event?.data?.content
    const text = Array.isArray(content) ? content.filter(block => block?.type === 'text').map(block => block.text).filter(Boolean).join('\n') : ''
    if (event?.type === 'user/message' && text && !text.startsWith('Current runtime context. This snapshot supersedes earlier runtime-context snapshots.')) return [{ kind: 'user', text, at: event.time, sourceSeq: event.seq }]
    if (event?.type === 'assistant/message' && text) return [{ kind: 'assistant', text, at: event.time, sourceSeq: event.seq }]
    return []
  })
}

async function loadThreadHistory() {}

function canReplaceView() {
  return state.draft === null && !state.dragging && !state.canvasGesture && Date.now() >= state.canvasRefreshAfter && !document.activeElement?.matches('textarea')
}

function deferCanvasRefresh(delay = 700) {
  state.canvasRefreshAfter = Math.max(state.canvasRefreshAfter, Date.now() + delay)
}

function currentDshWorkspace() {
  const id = state.currentDsh?.id
  return typeof id === 'string' ? state.dshWorkspaces.find(workspace => workspace.sessionIds.includes(id)) : undefined
}

function selectedDshWorkspace() {
  return state.dshWorkspaces.find(workspace => workspace.id === state.selectedDshWorkspaceId)
}

function currentDshThread(threads = state.workspace?.threads ?? []) {
  const id = state.currentDsh?.id
  return typeof id === 'string' ? threads.find(thread => thread.dshSessionId === id) : undefined
}

function workspaceChoices() {
  // DSH directories first, then Synapse-only workspaces (`kind !== 'dsh'`).
  // Without this, a standalone Synapse workspace is unreachable from the
  // sidebar for as long as any DSH workspace exists.
  const dsh = state.dshWorkspaces.map(workspace => ({ ...workspace, source: 'dsh' }))
  const standalone = state.summaries
    .filter(workspace => workspace.kind !== 'dsh')
    .map(workspace => ({ id: workspace.id, title: workspace.title, path: workspace.cwd, sessionIds: [], source: 'projection' }))
  return [...dsh, ...standalone]
}

async function threadsForDshWorkspace(workspace) {
  if (workspace.sessionIds.length === 0) return []
  const requested = new Set(workspace.sessionIds)
  const projections = await Promise.all(state.summaries.map(summary => api(`/synapse/api/workspaces/${summary.id}`)))
  return projections.flatMap(projection => projection.workspace.threads.filter(thread => requested.has(thread.dshSessionId)))
}

async function openDshWorkspace(id, { renderAfter = true, preserveCanvasCamera = false } = {}) {
  const workspace = state.dshWorkspaces.find(item => item.id === id)
  if (workspace === undefined) return false
  const load = ++state.workspaceLoad
  state.selectedDshWorkspaceId = id
  const threads = await threadsForDshWorkspace(workspace)
  if (load !== state.workspaceLoad) return true
  const nextWorkspaceId = `dsh:${workspace.id}`
  if (state.workspace?.id !== nextWorkspaceId && !preserveCanvasCamera) resetCanvasCamera()
  state.workspace = { id: nextWorkspaceId, title: workspace.title, cwd: workspace.path, threads }
  const currentThread = currentDshThread(state.workspace.threads)
  state.activeId = currentThread?.id ?? (state.workspace.threads.some(thread => thread.id === state.activeId) ? state.activeId : state.workspace.threads[0]?.id ?? null)
  if (currentThread !== undefined) revealConversationThread(conversationCards(state.workspace.threads), currentThread.id)
  if (renderAfter && canReplaceView()) render()
  await Promise.all(state.workspace.threads.map(thread => loadThreadHistory(thread, false)))
  if (renderAfter && load === state.workspaceLoad && canReplaceView()) render()
  return true
}

async function openCurrentWorkspace({ preserveCanvasCamera = false } = {}) {
  const workspace = currentDshWorkspace()
  if (workspace === undefined || workspace.id === state.selectedDshWorkspaceId) return false
  return openDshWorkspace(workspace.id, { preserveCanvasCamera })
}

async function refreshSummaries({ renderAfter = true } = {}) {
  const before = JSON.stringify(state.summaries)
  const body = await api('/synapse/api/workspaces')
  state.summaries = body.workspaces
  const changed = before !== JSON.stringify(state.summaries)
  const current = state.workspace?.id
  if (state.selectedDshWorkspaceId === null && current !== null && !state.summaries.some(item => item.id === current)) state.workspace = null
  const selected = selectedDshWorkspace()
  if (selected !== undefined && (changed || state.workspace === null)) await openDshWorkspace(selected.id, { renderAfter })
  else if (state.workspace === null && state.summaries.length > 0) await openWorkspace(state.summaries[0].id)
  else if (renderAfter && changed && canReplaceView()) render()
  return changed
}

async function openWorkspace(id, { renderAfter = true } = {}) {
  const load = ++state.workspaceLoad
  const body = await api(`/synapse/api/workspaces/${id}`)
  if (load !== state.workspaceLoad) return
  if (state.workspace?.id !== body.workspace.id) resetCanvasCamera()
  state.workspace = body.workspace
  state.activeId = state.workspace.threads.some(thread => thread.id === state.activeId) ? state.activeId : state.workspace.threads[0]?.id ?? null
  if (renderAfter && canReplaceView()) render()
  await Promise.all(state.workspace.threads.map(thread => loadThreadHistory(thread, false)))
  if (renderAfter && load === state.workspaceLoad && canReplaceView()) render()
}

async function refreshProjection() {
  const summariesChanged = await refreshSummaries({ renderAfter: false })
  if (!summariesChanged || state.workspace === null || !canReplaceView()) return summariesChanged
  if (state.selectedDshWorkspaceId !== null) await openDshWorkspace(state.selectedDshWorkspaceId)
  else await openWorkspace(state.workspace.id)
  return true
}

function openNewSession() {
  if (state.draft !== null) return
  state.mode = 'canvas'
  state.activeId = null
  state.selectedCardId = null
  state.inspectorCardId = null
  state.inspectorOpening = false
  state.quickPhraseEditorOpen = false
  state.draft = { kind: 'new', text: '', sending: false, attachments: [] }
  state.error = ''
  resetCanvasCamera()
  render()
  window.setTimeout(() => document.querySelector('[data-draft] textarea')?.focus(), 0)
}

async function archiveThread(thread) {
  if (!window.confirm(`归档画布中的「${thread.title}」及其分支？DSH 原会话会保留，可在 DSH 内继续查看。`)) return
  await api(`/synapse/api/threads/${thread.id}`, { method: 'DELETE' })
  state.historyBySession.delete(thread.dshSessionId)
  state.detailScrollByThread.delete(thread.id)
  state.detailTargetCardId = state.detailThreadId === thread.id ? null : state.detailTargetCardId
  if (state.workspace !== null) {
    const removed = new Set([thread.id])
    for (let changed = true; changed;) {
      changed = false
      for (const item of state.workspace.threads) {
        if (item.parentId !== null && removed.has(item.parentId) && !removed.has(item.id)) {
          removed.add(item.id)
          changed = true
        }
      }
    }
    state.workspace.threads = state.workspace.threads.filter(item => !removed.has(item.id))
    for (const key of [...state.cardPositions.keys()]) {
      if ([...removed].some(id => key.startsWith(`${id}:`))) state.cardPositions.delete(key)
    }
    let collapsedChanged = false
    for (const key of [...state.collapsedCardIds]) {
      if ([...removed].some(id => key.startsWith(`${id}:`))) {
        state.collapsedCardIds.delete(key)
        collapsedChanged = true
      }
    }
    if (collapsedChanged) persistCollapsedCards()
    let edgesChanged = false
    const referencesRemoved = key => {
      const [from, to] = key.split('>')
      return [...removed].some(id => from.startsWith(`${id}:`) || to.startsWith(`${id}:`))
    }
    for (const key of [...state.customEdges]) if (referencesRemoved(key)) { state.customEdges.delete(key); edgesChanged = true }
    for (const key of [...state.removedEdges]) if (referencesRemoved(key)) { state.removedEdges.delete(key); edgesChanged = true }
    if (edgesChanged) persistEdges()
    let hiddenChanged = false
    for (const id of [...state.hiddenCards.keys()]) {
      if ([...removed].some(threadId => id.startsWith(`${threadId}:`))) {
        state.hiddenCards.delete(id)
        hiddenChanged = true
      }
    }
    if (hiddenChanged) persistHiddenCards()
    let lockedChanged = false
    for (const id of [...state.lockedCards]) {
      if ([...removed].some(threadId => id.startsWith(`${threadId}:`))) {
        state.lockedCards.delete(id)
        lockedChanged = true
      }
    }
    if (lockedChanged) persistLockedCards()
    state.activeId = state.activeId !== null && state.workspace.threads.some(item => item.id === state.activeId)
      ? state.activeId
      : state.workspace.threads[0]?.id ?? null
    render()
  } else {
    state.activeId = null
  }
  await refreshSummaries()
}

function focusDraftInput() {
  const input = document.querySelector('[data-draft] textarea')
  if (!(input instanceof HTMLTextAreaElement)) return
  input.focus()
  input.setSelectionRange(input.value.length, input.value.length)
}

function openContinue(parent, anchorId = undefined, text = '') {
  if (parent.dshSessionId === null) return setError('该节点没有关联的 DSH 会话')
  state.activeId = parent.id
  state.quickPhraseEditorOpen = false
  state.draft = { kind: 'continue', parentId: parent.id, anchorId, text, sending: false, attachments: [] }
  render()
  window.setTimeout(focusDraftInput, 0)
}

function openBranch(parent, atSeq = undefined, anchorId = undefined) {
  if (parent.dshSessionId === null) return setError('该节点没有关联的 DSH 会话')
  state.activeId = parent.id
  state.quickPhraseEditorOpen = false
  state.draft = { kind: 'branch', parentId: parent.id, atSeq, anchorId, text: '', sending: false, attachments: [] }
  render()
  window.setTimeout(() => document.querySelector('[data-draft] textarea')?.focus(), 0)
}

async function sendMessage(thread, text, attachments = []) {
  if (thread.dshSessionId === null) throw new Error('该节点没有关联的 DSH 会话')
  if (state.pendingReplies.has(thread.dshSessionId)) throw new Error('该会话正在回复，请稍后再发送')
  state.pendingReplies.set(thread.dshSessionId, { text, at: Date.now() })
  state.error = ''
  render()
  try {
    await dshRpc('synapse:send-message', { sessionId: thread.dshSessionId, text, attachments })
    void loadThreadHistory(thread)
  } catch (error) {
    state.pendingReplies.delete(thread.dshSessionId)
    render()
    throw error
  }
}

async function submitDraft() {
  const draft = state.draft
  const text = draft?.text.trim()
  if (draft === null || !text) return
  const attachments = Array.isArray(draft.attachments) ? draft.attachments : []
  const branchPosition = draft.kind === 'branch' && state.workspace !== null ? draftPlacement(conversationCards(state.workspace.threads))?.position : undefined
  draft.sending = true
  state.error = ''
  render()
  try {
    if (draft.kind === 'new') {
      const session = await dshRpc('synapse:create-session', { workspaceId: state.selectedDshWorkspaceId, cwd: state.currentDsh?.cwd })
      addKeyToCurrentFolder(`${session.id}:turn-index:0`)
      await dshRpc('synapse:send-message', { sessionId: session.id, text, attachments })
      state.draft = null
      render()
      window.setTimeout(() => {
        void refreshProjection().catch(() => {})
      }, 150)
      return
    }
    const parent = state.workspace?.threads.find(thread => thread.id === draft.parentId)
    if (parent === undefined) throw new Error('来源会话不存在')
    if (draft.kind === 'continue') {
      // 追问 joins the end of the session, but the user wants the new card next
      // to the card they continued from: pin its predicted turn slot there.
      const allCards = state.workspace !== null ? conversationCards(state.workspace.threads) : []
      const threadCards = allCards.filter(card => card.dshThreadId === parent.id)
      const anchorCard = draft.anchorId === undefined
        ? threadCards.at(-1)
        : threadCards.find(card => card.id === draft.anchorId) ?? threadCards.at(-1)
      const hasEmpty = threadCards.length === 1 && threadCards[0].sourceSeq === undefined
      const turnIndex = hasEmpty ? 0 : threadCards.length
      if (anchorCard !== undefined) {
        state.cardPositions.set(`${parent.id}:turn-index:${turnIndex}`, besideCardPosition(anchorCard, allCards.map(card => card.position)))
        persistCardPositions()
      }
      addKeyToCurrentFolder(`${parent.id}:turn-index:${turnIndex}`)
      state.draft = null
      await sendMessage(parent, text, attachments)
      return
    }
    const session = await dshRpc('synapse:fork-session', { sessionId: parent.dshSessionId, atSeq: draft.atSeq })
    if (draft.anchorId !== undefined) rememberBranchAnchor(session.id, draft.anchorId)
    const result = await api(`/synapse/api/threads/${parent.id}/branch`, { method: 'POST', body: JSON.stringify({ title: text.slice(0, 42), dshSessionId: session.id, dshSessionTitle: session.title, position: branchPosition }) })
    if (state.workspace !== null && !state.workspace.threads.some(thread => thread.id === result.thread.id || thread.dshSessionId === result.thread.dshSessionId)) state.workspace.threads.push(result.thread)
    if (branchPosition !== undefined) {
      state.cardPositions.set(`${result.thread.id}:turn-index:0`, branchPosition)
      persistCardPositions()
    }
    addKeyToCurrentFolder(`${result.thread.id}:turn-index:0`)
    state.activeId = result.thread.id
    state.draft = null
    state.pendingReplies.set(result.thread.dshSessionId, { text, at: Date.now() })
    render()
    await dshRpc('synapse:send-message', { sessionId: result.thread.dshSessionId, text, attachments })
    void loadThreadHistory(result.thread)
    await refreshProjection()
  } catch (error) {
    if (draft.kind === 'branch') {
      state.pendingReplies.delete(state.workspace?.threads.find(thread => thread.id === state.activeId)?.dshSessionId)
      if (state.draft !== null) state.draft = { ...draft, sending: false }
    } else {
      state.draft = { ...draft, sending: false }
    }
    setError(error)
  }
}

function threadsById() { return new Map((state.workspace?.threads ?? []).map(thread => [thread.id, thread])) }
function persistedMessagesFor(thread) { return state.historyBySession.get(thread.dshSessionId) ?? thread.messages ?? [] }

function pendingUserIndex(messages, pending) {
  return messages.findLastIndex(message => message.kind === 'user' && message.text === pending.text && new Date(message.at).getTime() >= pending.at - 2_000)
}

function settlePendingReply(thread, messages) {
  const pending = state.pendingReplies.get(thread.dshSessionId)
  if (pending === undefined) return false
  const userIndex = pendingUserIndex(messages, pending)
  if (userIndex === -1 || !messages.slice(userIndex + 1).some(message => message.kind === 'assistant')) return false
  state.pendingReplies.delete(thread.dshSessionId)
  return true
}

function messagesFor(thread) {
  // A runtime-context snapshot is internal DSH state, never a user turn.
  // Filter here as well as during persistence so existing saved workspaces
  // immediately render one question and its answer as one card.
  const messages = persistedMessagesFor(thread).filter(message => !(message.kind === 'user' && typeof message.text === 'string' && message.text.trimStart().startsWith('Current runtime context. This snapshot supersedes earlier runtime-context snapshots.')))
  const pending = state.pendingReplies.get(thread.dshSessionId)
  if (pending === undefined) return messages
  if (settlePendingReply(thread, messages)) {
    state.liveReplies.delete(thread.dshSessionId)
    return messages
  }
  const liveReply = state.liveReplies.get(thread.dshSessionId)
  const liveAssistant = liveReply?.running ? { kind: 'assistant', text: liveReply.text, pending: true, at: new Date().toISOString() } : { kind: 'assistant', text: '', pending: true, at: new Date().toISOString() }
  const userIndex = pendingUserIndex(messages, pending)
  if (userIndex !== -1) return [...messages, liveAssistant]
  return [...messages, { kind: 'user', text: pending.text, pending: true, at: new Date(pending.at).toISOString() }, liveAssistant]
}

function latestMessage(thread, kind) { return [...messagesFor(thread)].reverse().find(message => message.kind === kind) }
function questionFor(thread) { return latestMessage(thread, 'user')?.text ?? thread.dshSessionTitle ?? '等待用户提问' }
function answerFor(thread) { return latestMessage(thread, 'assistant') ?? null }

function inlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
}

const tableCells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())

const isTableDelimiter = line => {
  const cells = tableCells(line)
  return cells.length > 0 && cells.every(cell => /^:?-+:?$/.test(cell))
}

function markdownBlock(text) {
  const lines = text.split('\n')
  const output = []
  for (let index = 0; index < lines.length;) {
    const line = lines[index]
    if (line.trim() === '') { index++; continue }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line)
    if (heading !== null) {
      const level = heading[1].length
      output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`)
      index++
      continue
    }
    const unordered = /^[-*+]\s+(.+)$/.exec(line)
    const ordered = /^\d+[.)]\s+(.+)$/.exec(line)
    if (unordered !== null || ordered !== null) {
      const matcher = unordered === null ? /^\d+[.)]\s+(.+)$/ : /^[-*+]\s+(.+)$/
      const items = []
      while (index < lines.length) {
        const item = matcher.exec(lines[index])
        if (item === null) break
        items.push(`<li>${inlineMarkdown(item[1])}</li>`)
        index++
      }
      output.push(`<${unordered === null ? 'ol' : 'ul'}>${items.join('')}</${unordered === null ? 'ol' : 'ul'}>`)
      continue
    }
    // GFM table: a leading-pipe header row followed by a |-delimiter row,
    // then any number of leading-pipe body rows.
    if (/^\s*\|/.test(line) && index + 1 < lines.length && isTableDelimiter(lines[index + 1])) {
      const header = line
      const body = []
      index += 2
      while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index])) {
        body.push(lines[index])
        index++
      }
      output.push(`<table><thead><tr>${tableCells(header).map(cell => `<th>${inlineMarkdown(cell)}</th>`).join('')}</tr></thead><tbody>${body.map(row => `<tr>${tableCells(row).map(cell => `<td>${inlineMarkdown(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`)
      continue
    }
    const paragraph = []
    while (index < lines.length && lines[index].trim() !== '' && !/^(#{1,3})\s+/.test(lines[index]) && !/^[-*+]\s+/.test(lines[index]) && !/^\d+[.)]\s+/.test(lines[index])) paragraph.push(lines[index++])
    // A marker-only line such as PowerShell's "+ " diagnostic is neither a
    // list item nor paragraph content under the rules above. Consume it so
    // the parser always makes progress.
    if (paragraph.length === 0) paragraph.push(lines[index++])
    output.push(`<p>${paragraph.map(inlineMarkdown).join('<br>')}</p>`)
  }
  return output.join('')
}

// Markdown parsing is pure CPU and repeats for every card on every canvas
// rebuild; cache the rendered HTML by input text so stable answers are never
// re-parsed. Bounded: streaming partial texts churn keys, so evict oldest.
const markdownCache = new Map()
const MARKDOWN_CACHE_LIMIT = 5000
function renderMarkdown(text) {
  const key = String(text)
  const cached = markdownCache.get(key)
  if (cached !== undefined) return cached
  const parts = key.split(/```/)
  const rendered = parts.map((part, index) => index % 2 === 1
    ? `<pre><code>${escapeHtml(part.replace(/^\w*\n/, ''))}</code></pre>`
    : markdownBlock(part)).join('')
  if (markdownCache.size >= MARKDOWN_CACHE_LIMIT) markdownCache.delete(markdownCache.keys().next().value)
  markdownCache.set(key, rendered)
  return rendered
}

function overlapsCard(position, other) {
  return position.x < other.x + CARD_WIDTH && position.x + CARD_WIDTH > other.x
    && position.y < other.y + CARD_HEIGHT && position.y + CARD_HEIGHT > other.y
}

function firstAvailableCardPosition(position, occupied) {
  const candidate = { x: Math.round(position.x), y: Math.max(82, Math.round(position.y)) }
  while (true) {
    const collisions = occupied.filter(other => overlapsCard(candidate, other))
    if (collisions.length === 0) return candidate
    candidate.y = Math.max(...collisions.map(other => other.y + CARD_HEIGHT + CARD_GAP_Y))
  }
}

function connectorPath(fromPosition, toPosition) {
  const fromX = fromPosition.x + CARD_WIDTH
  const fromY = fromPosition.y + CARD_HEIGHT / 2
  const toX = toPosition.x
  const toY = toPosition.y + CARD_HEIGHT / 2
  const bend = Math.min(110, Math.max(36, Math.abs(toX - fromX) * .2))
  return `M ${fromX} ${fromY} C ${fromX + bend} ${fromY}, ${toX - bend} ${toY}, ${toX} ${toY}`
}

// Preview curve while dragging a new link out of a card's bottom port.
function connectorPathToPoint(fromPosition, point, side = 'right') {
  const fromX = side === 'left' ? fromPosition.x : fromPosition.x + CARD_WIDTH
  const fromY = fromPosition.y + CARD_HEIGHT / 2
  const bend = Math.min(120, Math.max(40, Math.abs(point.x - fromX) * .25))
  const c1x = side === 'left' ? fromX - bend : fromX + bend
  return `M ${fromX} ${fromY} C ${c1x} ${fromY}, ${point.x} ${point.y}, ${point.x} ${point.y}`
}

// Link path between a chosen side of the source and a chosen side of the target.
function connectorPathSides(fromPosition, fromSide, toPosition, toSide) {
  const fromX = fromSide === 'left' ? fromPosition.x : fromPosition.x + CARD_WIDTH
  const fromY = fromPosition.y + CARD_HEIGHT / 2
  const toX = toSide === 'left' ? toPosition.x : toPosition.x + CARD_WIDTH
  const toY = toPosition.y + CARD_HEIGHT / 2
  const bend = Math.min(110, Math.max(36, Math.abs(toX - fromX) * .2))
  const c1x = fromSide === 'left' ? fromX - bend : fromX + bend
  const c2x = toSide === 'left' ? toX - bend : toX + bend
  return `M ${fromX} ${fromY} C ${c1x} ${fromY}, ${c2x} ${toY}, ${toX} ${toY}`
}

function connectorPathFromElements(fromCard, toCard) {
  const fromX = Number.parseFloat(fromCard.style.left) + CARD_WIDTH
  const fromY = Number.parseFloat(fromCard.style.top) + CARD_HEIGHT / 2
  const toX = Number.parseFloat(toCard.style.left)
  const toY = Number.parseFloat(toCard.style.top) + CARD_HEIGHT / 2
  if (![fromX, fromY, toX, toY].every(Number.isFinite)) return null
  const bend = Math.min(110, Math.max(36, Math.abs(toX - fromX) * .2))
  return `M ${fromX} ${fromY} C ${fromX + bend} ${fromY}, ${toX - bend} ${toY}, ${toX} ${toY}`
}

function selectorValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

// Connector paths are rebuilt together with the canvas DOM; cache the mapping
// from card id to its incident paths so dragging never scans the whole SVG.
let connectorPathsByCard = new Map()
function cacheCardConnectors() {
  connectorPathsByCard = new Map()
  const viewport = document.querySelector('.canvas-viewport')
  if (!(viewport instanceof HTMLElement)) return
  for (const path of viewport.querySelectorAll('.connectors path[data-from]')) {
    const fromId = path.getAttribute('data-from')
    const toId = path.getAttribute('data-to')
    if (fromId === null || toId === null) continue
    for (const id of [fromId, toId]) {
      const paths = connectorPathsByCard.get(id)
      if (paths === undefined) connectorPathsByCard.set(id, new Set([path]))
      else paths.add(path)
    }
  }
}

function refreshCardConnectors(cardId) {
  const paths = connectorPathsByCard.get(cardId)
  if (paths === undefined || paths.size === 0) return
  const byId = state.viewNodesById ?? state.canvasCardsById
  if (byId === undefined) return
  for (const path of paths) {
    const fromId = path.getAttribute('data-from')
    const toId = path.getAttribute('data-to')
    if (fromId === null || toId === null) continue
    const fromCard = byId.get(fromId)
    const toCard = byId.get(toId)
    if (fromCard === undefined || toCard === undefined) continue
    // Data-driven endpoints: the counterpart card may be unmounted (outside
    // the viewport) but its position is still authoritative.
    const fromSide = (toCard.position.x + CARD_WIDTH / 2) >= (fromCard.position.x + CARD_WIDTH / 2) ? 'right' : 'left'
    const toSide = fromSide === 'right' ? 'left' : 'right'
    path.setAttribute('data-from-side', fromSide)
    path.setAttribute('data-to-side', toSide)
    path.setAttribute('d', connectorPathSides(fromCard.position, fromSide, toCard.position, toSide))
  }
}

function initialCanvasCamera(cards) {
  const draft = state.draft?.kind === 'new' ? { id: 'draft:new', position: { x: 86, y: 82 } } : draftPlacement(cards)
  // Focus the active conversation's latest turn, not its first: after many
  // rounds the canvas should open where work is happening, at the newest card.
  const activeCards = state.activeId === null || state.activeId === undefined ? [] : cards.filter(card => card.dshThreadId === state.activeId)
  const active = activeCards.at(-1)
  const focus = draft ?? active ?? cards[0]
  const position = focus?.position
  if (position === undefined) return { x: 0, y: 0 }
  return { x: CAMERA_INSET_X - position.x * state.zoom, y: CAMERA_INSET_Y - position.y * state.zoom }
}

function placeConversationCards(cards) {
  const saved = new Map(cards.flatMap(card => {
    if (card.positionLocked !== true) return []
    const position = state.cardPositions.get(card.id) ?? state.cardPositions.get(card.positionKey)
    return position === undefined ? [] : [[card.id, { x: position.x, y: position.y }]]
  }))
  const occupied = [...saved.values()]
  for (const card of cards) {
    const position = saved.get(card.id)
    if (position !== undefined) {
      card.position = position
      continue
    }
    card.position = firstAvailableCardPosition(card.naturalPosition ?? card.position, occupied)
    occupied.push(card.position)
  }
  return cards
}

// 一键整理: locked cards move as ONE rigid block (their relative layout is
// preserved) shifted to the spot the tree layout wants, and unlocked cards
// re-flow around it. Nothing overlaps: the block is placed first and every
// other card is packed with firstAvailableCardPosition against it.
function layoutConversationGraph(cards, threads) {
  const childrenByThread = new Map()
  for (const thread of threads) {
    if (thread.parentId === null) continue
    const children = childrenByThread.get(thread.parentId) ?? []
    children.push(thread.id)
    childrenByThread.set(thread.parentId, children)
  }
  const laneByThread = new Map()
  const visitThread = threadId => {
    if (laneByThread.has(threadId)) return
    laneByThread.set(threadId, laneByThread.size)
    for (const childId of childrenByThread.get(threadId) ?? []) visitThread(childId)
  }
  for (const thread of threads) if (thread.parentId === null) visitThread(thread.id)
  for (const thread of threads) visitThread(thread.id)

  const byId = new Map(cards.map(card => [card.id, card]))
  const positioned = new Map()
  const positionFor = (card, visiting = new Set()) => {
    if (positioned.has(card.id)) return positioned.get(card.id)
    if (visiting.has(card.id)) return { x: 86, y: 82 + (laneByThread.get(card.dshThreadId) ?? 0) * (CARD_HEIGHT + CARD_GAP_Y) }
    visiting.add(card.id)
    const parent = card.parentId === null ? undefined : byId.get(card.parentId)
    const parentPosition = parent === undefined ? undefined : positionFor(parent, visiting)
    const position = {
      x: parentPosition === undefined ? 86 : parentPosition.x + 365,
      y: 82 + (laneByThread.get(card.dshThreadId) ?? 0) * (CARD_HEIGHT + CARD_GAP_Y),
    }
    visiting.delete(card.id)
    positioned.set(card.id, position)
    return position
  }
  for (const card of cards) {
    card.naturalPosition = positionFor(card)
    if (!card.positionLocked) card.position = card.naturalPosition
  }
  return placeConversationCards(cards)
}

function conversationCards(threads) {
  const cards = []
  const cardsByThread = new Map()
  for (const thread of threads) {
    const messages = messagesFor(thread)
    const turns = []
    for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
      const question = messages[messageIndex]
      if (question.kind !== 'user') continue
      const replies = []
      const errors = []
      let processCount = 0
      for (let replyIndex = messageIndex + 1; replyIndex < messages.length; replyIndex++) {
        const reply = messages[replyIndex]
        if (reply.kind === 'user') break
        if (reply.kind === 'assistant') replies.push(reply)
        if (reply.kind === 'error') errors.push(reply)
        if (Array.isArray(reply.process)) processCount += reply.process.length
        else if (reply.kind === 'tool') processCount += 1
      }
      const answer = replies.at(-1) ?? null
      const error = errors.at(-1) ?? null
      const turnIndex = turns.length
      const id = `${thread.id}:turn:${question.sourceSeq ?? messageIndex}`
      const previous = turns.at(-1)
      const positionKey = `${thread.id}:turn-index:${turnIndex}`
      const naturalPosition = previous === undefined ? { x: 86, y: 82 } : { x: previous.naturalPosition.x + 365, y: previous.naturalPosition.y }
      const savedPosition = state.cardPositions?.get(id) ?? state.cardPositions?.get(positionKey)
      const positionLocked = savedPosition !== undefined
      const position = positionLocked ? savedPosition : naturalPosition
      turns.push({
        id,
        positionKey,
        dshThreadId: thread.id,
        sourceParentId: thread.parentId,
        parentId: null,
        sourceSeq: question.sourceSeq,
        turnIndex,
        naturalPosition,
        position,
        positionLocked,
        question: question.text,
        answer,
        error,
        processCount,
      })
    }
    const liveReply = state.liveReplies.get(thread.dshSessionId)
    const latestTurn = turns.at(-1)
    if (liveReply?.running && latestTurn !== undefined && (latestTurn.answer === null || latestTurn.answer.pending === true)) latestTurn.answer = { kind: 'assistant', text: liveReply.text, pending: true, at: new Date().toISOString() }
    if (turns.length === 0) {
      const id = `${thread.id}:turn:empty`
      const positionKey = `${thread.id}:turn-index:0`
      const naturalPosition = { x: 86, y: 82 }
      const savedPosition = state.cardPositions?.get(id) ?? state.cardPositions?.get(positionKey)
      const positionLocked = savedPosition !== undefined
      turns.push({
      id,
      positionKey,
      dshThreadId: thread.id,
      sourceParentId: thread.parentId,
      parentId: null,
      sourceSeq: undefined,
      turnIndex: 0,
      naturalPosition,
      position: positionLocked ? savedPosition : naturalPosition,
      positionLocked,
      question: thread.dshSessionTitle ?? thread.title,
      answer: null,
      error: null,
      processCount: 0,
      })
    }
    turns.at(-1).canContinue = true
    cardsByThread.set(thread.id, turns)
    cards.push(...turns)
  }
  for (const card of cards) {
    const siblings = cardsByThread.get(card.dshThreadId)
    if (card.turnIndex > 0) card.parentId = siblings[card.turnIndex - 1].id
    else {
      const parentCards = cardsByThread.get(card.sourceParentId)
      const sourceThread = threads.find(thread => thread.id === card.dshThreadId)
      const firstChildQuestion = siblings?.[0]
      const seedLength = sourceThread?.sourceSeedLength ?? firstChildQuestion?.sourceSeq
      // A fork inherits every parent event before DSH's durable seed boundary.
      // The latest parent question below that boundary is the exact Turn where
      // this child was born. Canvas coordinates never participate in lineage.
      const inheritedTurn = Number.isSafeInteger(seedLength)
        ? parentCards?.filter(candidate => Number.isInteger(candidate.sourceSeq) && candidate.sourceSeq < seedLength).at(-1)
        : undefined
      card.parentId = state.branchAnchors.get(card.dshThreadId) ?? inheritedTurn?.id ?? null
    }
  }
  return layoutConversationGraph(cards, threads)
}

function conversationGraphView(cards, collapsedCardIds = state.collapsedCardIds) {
  const cardIds = new Set(cards.map(card => card.id))
  const childrenByParent = new Map()
  for (const card of cards) {
    if (card.parentId === null || !cardIds.has(card.parentId)) continue
    const children = childrenByParent.get(card.parentId) ?? []
    children.push(card.id)
    childrenByParent.set(card.parentId, children)
  }

  const hiddenIds = new Set()
  for (const rootId of collapsedCardIds) {
    if (!cardIds.has(rootId)) continue
    const visited = new Set([rootId])
    const visit = parentId => {
      for (const childId of childrenByParent.get(parentId) ?? []) {
        if (visited.has(childId)) continue
        visited.add(childId)
        hiddenIds.add(childId)
        visit(childId)
      }
    }
    visit(rootId)
  }

  // Persisted collapse roots must remain visible even if malformed metadata
  // contains a cycle where two collapsed nodes otherwise hide each other.
  for (const rootId of collapsedCardIds) hiddenIds.delete(rootId)

  // Post-order accumulation: each card's descendant count is 1 + the sum of
  // its children's subtree sizes, so the whole graph is O(n) instead of a BFS
  // from every card (O(n²) on deep chains). Malformed parent cycles are
  // detected through the DFS path: every member of a cycle reaches every other
  // member plus the union of their off-cycle subtrees, so when the cycle entry
  // pops last, all members are settled to (cycleSize - 1) + off-cycle total,
  // which matches the per-card BFS' unique-descendant count.
  const descendantCounts = new Map()
  const inStack = new Set()
  for (const card of cards) {
    if (descendantCounts.has(card.id)) continue
    const stack = [{ id: card.id, children: childrenByParent.get(card.id) ?? [], index: 0 }]
    const path = [card.id]
    let cycleEntry = null
    let cycleMembers = null
    let cycleOffCycleTotal = 0
    inStack.add(card.id)
    while (stack.length > 0) {
      const top = stack[stack.length - 1]
      if (top.index < top.children.length) {
        const childId = top.children[top.index++]
        if (descendantCounts.has(childId)) continue
        if (inStack.has(childId)) {
          // Back edge: the nodes from childId up to top.id form a cycle.
          cycleEntry = childId
          cycleMembers = new Set(path.slice(path.indexOf(childId)))
          cycleOffCycleTotal = 0
          continue
        }
        inStack.add(childId)
        path.push(childId)
        stack.push({ id: childId, children: childrenByParent.get(childId) ?? [], index: 0 })
      } else {
        stack.pop()
        path.pop()
        inStack.delete(top.id)
        let count = 0
        for (const childId of top.children) {
          if (cycleMembers !== null && cycleMembers.has(childId)) continue // ring edge; base count added below
          count += 1 + (descendantCounts.get(childId) ?? 0)
        }
        if (cycleMembers !== null && cycleMembers.has(top.id)) cycleOffCycleTotal += count
        if (cycleMembers !== null && top.id === cycleEntry) {
          // All cycle members have popped (the entry pops last in post-order);
          // settle them so ancestors popping next read the final counts.
          const base = cycleMembers.size - 1
          for (const id of cycleMembers) descendantCounts.set(id, base + cycleOffCycleTotal)
          cycleEntry = null
          cycleMembers = null
        } else {
          descendantCounts.set(top.id, count)
        }
      }
    }
  }

  return {
    cards: cards.filter(card => !hiddenIds.has(card.id)),
    childCounts: new Map(cards.map(card => [card.id, childrenByParent.get(card.id)?.length ?? 0])),
    descendantCounts,
  }
}

function revealConversationThread(cards, threadId) {
  const byId = new Map(cards.map(card => [card.id, card]))
  let changed = false
  for (const target of cards.filter(card => card.dshThreadId === threadId)) {
    const visited = new Set([target.id])
    let parentId = target.parentId
    while (parentId !== null && !visited.has(parentId)) {
      visited.add(parentId)
      if (state.collapsedCardIds.delete(parentId)) changed = true
      parentId = byId.get(parentId)?.parentId ?? null
    }
  }
  if (changed) persistCollapsedCards()
}

// The set of links drawn on the canvas: the branch/追问 edges derived from the
// session tree (minus any the user hid) plus the user's own hand-drawn edges.
function conversationEdges(cards) {
  const ids = new Set(cards.map(card => card.id))
  const edges = []
  const seen = new Set()
  for (const card of cards) {
    if (card.parentId === null || !ids.has(card.parentId)) continue
    const key = edgeKey(card.parentId, card.id)
    if (state.removedEdges.has(key) || seen.has(key)) continue
    seen.add(key)
    edges.push({ key, from: card.parentId, to: card.id, custom: false, fromSide: 'right', toSide: 'left' })
  }
  for (const key of state.customEdges) {
    const [from, to] = key.split('>')
    if (from === undefined || to === undefined || from === to || seen.has(key)) continue
    const fromOk = ids.has(from) || (from.startsWith('folder:') && state.folders.has(from.slice(7)))
    const toOk = ids.has(to) || (to.startsWith('folder:') && state.folders.has(to.slice(7)))
    if (!fromOk || !toOk) continue
    seen.add(key)
    const sides = state.edgeSides.get(key) ?? { fromSide: 'right', toSide: 'left' }
    edges.push({ key, from, to, custom: true, fromSide: sides.fromSide, toSide: sides.toSide })
  }
  return edges
}

// Build an Obsidian Canvas document for the current workspace: one text node
// per conversation card, one edge per drawn link (branch/追问 or hand-made).
function buildObsidianCanvas() {
  const cards = state.canvasCards ?? []
  if (cards.length === 0) return null
  const nodeIdByCard = new Map(cards.map((card, index) => [card.id, `n${index}`]))
  const nodes = cards.map(card => ({
    id: nodeIdByCard.get(card.id),
    type: 'text',
    text: canvasNodeText(card),
    x: card.position.x,
    y: card.position.y,
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
  }))
  const edges = []
  for (const edge of conversationEdges(cards)) {
    const fromNode = nodeIdByCard.get(edge.from)
    const toNode = nodeIdByCard.get(edge.to)
    if (fromNode === undefined || toNode === undefined) continue
    edges.push({ id: `e${edges.length}`, fromNode, fromSide: 'right', toNode, toSide: 'left' })
  }
  return { nodes, edges }
}

function canvasNodeText(card) {
  const lines = [`# ${card.question}`]
  if (typeof card.answer?.text === 'string' && card.answer.text.trim() !== '') lines.push(card.answer.text.trim())
  else if (card.error !== null && card.error !== undefined) lines.push(`> 本轮失败：${card.error.text}`)
  return lines.join('\n\n')
}

function canvasExportFilename() {
  const raw = state.workspace?.title ?? state.workspace?.cwd ?? 'synapse'
  const base = String(raw).replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 60) || 'synapse'
  return `${base}.canvas`
}

function buildObsidianCanvasForView(viewFolderId) {
  const allCards = state.workspace !== null ? conversationCards(state.workspace.threads) : []
  const visible = allCards.filter(card => !state.hiddenCards.has(card.id))
  const owned = visible.filter(card => containerOfCardKey(cardKeyOf(card)) === viewFolderId)
  const folders = childFoldersOf(viewFolderId)
  if (owned.length === 0 && folders.length === 0) return null
  const nodeIdByCard = new Map(owned.map((card, index) => [card.id, `n${index}`]))
  const nodes = owned.map(card => ({ id: nodeIdByCard.get(card.id), type: 'text', text: canvasNodeText(card), x: card.position.x, y: card.position.y, width: CARD_WIDTH, height: CARD_HEIGHT }))
  for (const folder of folders) {
    nodes.push({ id: `f:${folder.id}`, type: 'text', text: `📁 ${folder.name}\n（${state.folderCards.get(folder.id)?.size ?? 0} 张卡片）`, x: folder.position.x, y: folder.position.y, width: CARD_WIDTH, height: CARD_HEIGHT })
  }
  const idSet = new Set(owned.map(card => card.id))
  const edges = []
  for (const edge of conversationEdges(visible)) {
    if (!idSet.has(edge.from) || !idSet.has(edge.to)) continue
    edges.push({ id: `e${edges.length}`, fromNode: nodeIdByCard.get(edge.from), fromSide: 'right', toNode: nodeIdByCard.get(edge.to), toSide: 'left' })
  }
  return { nodes, edges }
}

function safeFileName(name, fallback) {
  const base = String(name ?? '').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 50)
  return base === '' ? fallback : base
}

async function exportCanvas() {
  const workspaceTitle = state.workspace?.title ?? state.workspace?.cwd ?? 'synapse'
  const jobs = []
  const root = buildObsidianCanvasForView(null)
  if (root !== null) jobs.push({ filename: `${safeFileName(workspaceTitle, 'synapse')}.canvas`, canvas: root })
  for (const folder of state.folders.values()) {
    const canvas = buildObsidianCanvasForView(folder.id)
    if (canvas !== null) jobs.push({ filename: `${safeFileName(folder.name, 'folder')}-${folder.id.slice(0, 6)}.canvas`, canvas })
  }
  if (jobs.length === 0) return setError('当前没有可导出的卡片')
  try {
    const paths = []
    for (const job of jobs) {
      const body = await api('/synapse/api/export', { method: 'POST', body: JSON.stringify({ filename: job.filename, content: JSON.stringify(job.canvas, null, 2) }) })
      paths.push(body.path)
    }
    shortcutHint(`已导出 ${paths.length} 个 canvas：${paths[0]}`, true)
  } catch (error) {
    setError(error)
  }
}

function canvasConnectors(cards) {
  const index = new Map(cards.map(card => [card.id, card]))
  const links = []
  for (const edge of conversationEdges(cards)) {
    const from = index.get(edge.from)
    const to = index.get(edge.to)
    if (from === undefined || to === undefined) continue
    const active = from.dshThreadId === state.activeId && to.dshThreadId === state.activeId ? ' active-connector' : ''
    const custom = edge.custom ? ' custom-connector' : ''
    const path = connectorPath(from.position, to.position)
    links.push(`<g class="edge-group${custom}" data-edge="${escapeHtml(edge.key)}"><title>点击删除这条连线</title><path class="edge-hit" data-from="${escapeHtml(edge.from)}" data-to="${escapeHtml(edge.to)}" d="${path}"></path><path class="edge-path${active}${custom}" data-from="${escapeHtml(edge.from)}" data-to="${escapeHtml(edge.to)}" d="${path}"></path></g>`)
  }
  const placement = draftPlacement(cards)
  if (placement !== null) {
    links.push(`<path class="draft-connector" data-from="${escapeHtml(placement.parent.id)}" data-to="draft" d="${connectorPath(placement.parent.position, placement.position)}"></path>`)
  }
  return links.join('')
}

function conversationCard(card, graph) {
  const selected = card.id === state.selectedCardId ? 'selected' : ''
  const groupSelected = state.selectedCardIds.has(card.id) ? ' group-selected' : ''
  const groupLocked = lockGroupOf(cardKeyOf(card)) !== null ? ' group-locked' : ''
  const source = card.parentId === null ? 'DSH 会话' : card.turnIndex === 0 ? 'DSH 分支' : '追问'
  const continueButton = card.canContinue === true
    ? `<button class="graph-continue-button" data-action="open-continue" data-thread="${card.dshThreadId}" data-card="${escapeHtml(card.id)}" aria-label="添加追问" title="添加追问"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M8 3.5v9M3.5 8h9"/></svg></button>`
    : ''
  const childCount = graph.childCounts.get(card.id) ?? 0
  const collapsed = state.collapsedCardIds.has(card.id)
  const foldLabel = collapsed ? '展开后续对话' : '折叠后续对话'
  const foldButton = childCount === 0 || card.canContinue === true ? '' : `<button class="graph-fold-button${collapsed ? ' collapsed' : ''}" data-action="toggle-card-children" data-card="${escapeHtml(card.id)}" aria-expanded="${collapsed ? 'false' : 'true'}" aria-label="${foldLabel}" title="${foldLabel}"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M3.5 8h9"/>${collapsed ? '<path d="M8 3.5v9"/>' : ''}</svg></button>`
  const branchButton = childCount === 0 || card.canContinue === true || !Number.isInteger(card.answer?.sourceSeq) ? '' : `<button class="graph-branch-button" data-action="open-branch" data-thread="${card.dshThreadId}" data-card="${escapeHtml(card.id)}" data-seq="${card.answer.sourceSeq}" aria-label="在新对话中分支" title="在新对话中分支"><svg aria-hidden="true" viewBox="0 0 16 16"><path fill-rule="evenodd" clip-rule="evenodd" d="M13.0762 1.37207C14.0846 1.37228 14.9021 2.19077 14.9023 3.19922C14.9022 4.20772 14.0847 5.02518 13.0762 5.02539C12.2967 5.02539 11.6325 4.53691 11.3701 3.84961H4.35547C4.79397 4.26458 5.15861 4.7644 5.41699 5.33496L7.10645 9.06738C7.88526 10.7875 9.55104 11.9228 11.4189 12.0371C11.7085 11.4109 12.3411 10.9756 13.0762 10.9756C14.0843 10.9759 14.9023 11.7936 14.9023 12.8018C14.9023 13.81 14.0843 14.6277 13.0762 14.6279C12.2534 14.6279 11.5574 14.0832 11.3291 13.335C8.9868 13.1879 6.89981 11.7612 5.92285 9.60352L4.23242 5.87109C3.67503 4.64033 2.44878 3.84961 1.09766 3.84961V2.54883C1.10665 2.54883 1.11601 2.54975 1.125 2.5498L11.3701 2.54883C11.6326 1.86151 12.2969 1.37207 13.0762 1.37207ZM13.0762 12.2764C12.7858 12.2764 12.5508 12.5114 12.5508 12.8018C12.5508 13.0921 12.7858 13.3281 13.0762 13.3281C13.3664 13.3279 13.6025 13.092 13.6025 12.8018C13.6025 12.5115 13.3664 12.2766 13.0762 12.2764ZM13.0762 2.67285C12.7855 2.67285 12.55 2.90861 12.5498 3.19922C12.5499 3.48987 12.7855 3.72559 13.0762 3.72559C13.3667 3.72538 13.6024 3.48975 13.6025 3.19922C13.6023 2.90874 13.3666 2.67306 13.0762 2.67285Z" fill="currentColor"/></svg></button>`
  return `<article class="thread-card ${selected}${groupSelected}${groupLocked}" data-card-id="${escapeHtml(card.id)}" data-position-key="${escapeHtml(card.positionKey)}" data-thread="${card.dshThreadId}" style="left:${card.position.x}px;top:${card.position.y}px;--thread-color:#3478f6">
    <button class="node-handle" data-drag-card="${card.id}" aria-label="拖动 ${escapeHtml(card.question)}" title="拖动卡片"></button>
    <button class="edge-port port-left" data-connect-from="${escapeHtml(card.id)}" data-connect-side="left" aria-label="从左侧拖出连线" title="从左侧拖出连线"></button>
    <button class="edge-port port-right" data-connect-from="${escapeHtml(card.id)}" data-connect-side="right" aria-label="从右侧拖出连线" title="从右侧拖出连线"></button>
    ${continueButton}${foldButton}${branchButton}
    <div class="thread-card-head"><span class="topic-dot"></span><button class="thread-title" data-action="show-thread" data-thread="${card.dshThreadId}" data-card="${escapeHtml(card.id)}" title="查看完整会话：${escapeHtml(card.question)}">${escapeHtml(card.question)}</button><button class="card-hide-button" data-action="hide-card" data-card="${escapeHtml(card.id)}" title="隐藏这张卡片" aria-label="隐藏这张卡片"><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4Z"/><circle cx="8" cy="8" r="1.8"/><path d="m3 13 10-10"/></svg></button></div>
    <div class="thread-meta"><span>${source}</span><span>第 ${card.turnIndex + 1} 轮</span>${card.error === null ? '' : '<span class="card-error-status">失败</span>'}${card.processCount > 0 ? `<span class="card-process-count">工具 ${card.processCount}</span>` : ''}</div>
    <div class="thread-answer">${card.answer === null ? (card.error === null ? '<p class="thread-answer-empty">等待助手回复</p>' : '') : card.answer.pending && card.answer.text === '' ? '<p class="thread-answer-pending">正在回复</p>' : `${renderMarkdown(card.answer.text)}${card.answer.pending ? '<p class="thread-answer-pending">正在回复</p>' : ''}`}${card.error === null ? '' : `<p class="thread-answer-error" title="${escapeHtml(card.error.text)}">本轮失败：${escapeHtml(card.error.text)}</p>`}</div>
    <footer>${state.viewFolderId === null ? '' : `<button data-action="move-card-out" data-card="${escapeHtml(card.id)}" title="移出文件夹">移出</button>`}<button data-action="show-thread" data-thread="${card.dshThreadId}" data-card="${escapeHtml(card.id)}" title="查看完整会话" aria-label="查看完整会话"><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M2 8.5 8 2.5l6 6V13.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5Z"/><path d="M6.2 14v-3.6a1.8 1.8 0 0 1 3.6 0V14" /></svg>详情</button><button data-action="open-dsh" data-thread="${card.dshThreadId}" data-seq="${Number.isInteger(card.sourceSeq) ? card.sourceSeq : ''}" title="在 DSH 中打开" aria-label="在 DSH 中打开"><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3.5H4.5A1.5 1.5 0 0 0 3 5v6.5A1.5 1.5 0 0 0 4.5 13H11a1.5 1.5 0 0 0 1.5-1.5V9"/><path d="M9.5 3.5h3v3M12.4 3.6 7.5 8.5"/></svg>DSH</button><button data-action="archive-thread" data-thread="${card.dshThreadId}" title="归档此会话" aria-label="归档此会话"><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 5h11M5.5 7v5.5a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1V7"/><path d="M4 5 5 2.8a.7.7 0 0 1 .6-.4h4.8a.7.7 0 0 1 .6.4L12 5M6 9.5h4"/></svg>归档</button></footer>
  </article>`
}

function draftActions(draft) {
  const disabled = draft.sending ? 'disabled' : ''
  return `<div class="draft-actions"><button type="button" data-action="cancel-draft" ${disabled} aria-label="取消" title="取消"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg></button><button class="primary" type="submit" ${disabled} aria-label="发送" title="发送"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 12.5v-9M4.5 7 8 3.5 11.5 7"/></svg></button></div>`
}

// Attachment chips + a paperclip file picker for the active draft card.
function draftAttachments(draft) {
  const disabled = draft.sending ? 'disabled' : ''
  const attachments = Array.isArray(draft.attachments) ? draft.attachments : []
  const chips = attachments.map((file, index) => `<span class="draft-attachment"><span class="draft-attachment-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name || '附件')}</span><button type="button" data-action="remove-attachment" data-index="${index}" aria-label="移除附件" title="移除" ${disabled}>×</button></span>`).join('')
  return `<div class="draft-attachments">${chips}<label class="draft-attach-button" title="添加附件（图片或文件）"><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 4.5 5.2 9.8a2 2 0 0 0 2.8 2.8l5-5a3.2 3.2 0 0 0-4.5-4.5l-5 5a4.4 4.4 0 0 0 6.2 6.2l4.3-4.3"/></svg><input type="file" multiple data-draft-file ${disabled}></label></div>`
}

function quickPhraseEditor(draft) {
  const disabled = draft.sending ? 'disabled' : ''
  const phrases = state.quickPhrases.map((phrase, index) => `<div class="draft-quick-phrase-editor-row"><input data-quick-phrase-index="${index}" maxlength="${MAX_QUICK_PHRASE_LENGTH}" value="${escapeHtml(phrase)}" aria-label="快捷词 ${index + 1}" ${disabled}><button type="button" data-action="remove-quick-phrase" data-quick-phrase-index="${index}" aria-label="删除 ${escapeHtml(phrase)}" title="删除" ${disabled}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg></button></div>`).join('')
  return `<section class="draft-quick-editor" aria-label="编辑快捷词"><div class="draft-quick-editor-list">${phrases}</div><div class="draft-quick-phrase-add"><input maxlength="${MAX_QUICK_PHRASE_LENGTH}" placeholder="添加快捷词" aria-label="添加快捷词" ${disabled}><button class="primary" type="button" data-action="add-quick-phrase" aria-label="添加快捷词" title="添加快捷词" ${disabled}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"/></svg></button></div><button class="draft-quick-editor-close" type="button" data-action="close-quick-phrase-editor" ${disabled}>完成</button></section>`
}

function draftQuickPhrases(draft) {
  const disabled = draft.sending ? 'disabled' : ''
  if (state.quickPhraseEditorOpen) return quickPhraseEditor(draft)
  const phrases = state.quickPhrases.map(phrase => `<button class="draft-quick-phrase" type="button" data-action="insert-quick-phrase" data-quick-phrase="${escapeHtml(phrase)}" ${disabled}>${escapeHtml(phrase)}</button>`).join('')
  return `<div class="draft-quick-phrases" aria-label="常用补充词">${phrases}<button class="draft-quick-phrase-add-button" type="button" data-action="open-quick-phrase-editor" aria-label="管理快捷词" title="管理快捷词" ${disabled}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"/></svg></button></div>`
}

function insertQuickPhrase(phrase) {
  const input = document.querySelector('[data-draft] textarea')
  if (!(input instanceof HTMLTextAreaElement) || state.draft === null) return
  const start = input.selectionStart
  const end = input.selectionEnd
  const prefix = input.value.slice(0, start)
  const suffix = input.value.slice(end)
  const separator = prefix !== '' && !prefix.endsWith('\n') ? '\n' : ''
  const text = `${prefix}${separator}${phrase}${suffix}`
  if (text.length > input.maxLength) return setError('追问内容不能超过 4000 个字符')
  const caret = prefix.length + separator.length + phrase.length
  input.value = text
  state.draft.text = text
  input.focus()
  input.setSelectionRange(caret, caret)
}

function addQuickPhrase(value) {
  const phrase = value.trim().slice(0, MAX_QUICK_PHRASE_LENGTH)
  if (phrase === '') return false
  if (state.quickPhrases.includes(phrase)) return setError('这个快捷词已经存在')
  if (state.quickPhrases.length >= MAX_QUICK_PHRASES) return setError(`最多保留 ${MAX_QUICK_PHRASES} 个快捷词`)
  pushHistory()
  state.quickPhrases.push(phrase)
  persistQuickPhrases()
  return true
}

function updateQuickPhrase(index, value) {
  if (!Number.isInteger(index) || index < 0 || index >= state.quickPhrases.length) return
  const phrase = value.trim().slice(0, MAX_QUICK_PHRASE_LENGTH)
  if (phrase === '') {
    pushHistory()
    state.quickPhrases.splice(index, 1)
  } else if (state.quickPhrases.some((item, itemIndex) => itemIndex !== index && item === phrase)) {
    return setError('这个快捷词已经存在')
  } else {
    pushHistory()
    state.quickPhrases[index] = phrase
  }
  persistQuickPhrases()
  render()
}

// Position for a card that should sit next to `anchor`: prefer the cell to its
// right, then directly below, then the nearest free cell (searched outward so
// the card is never shoved far away).
function besideCardPosition(anchor, occupied) {
  const stepX = CARD_WIDTH + 55
  const stepY = CARD_HEIGHT + CARD_GAP_Y
  const free = (x, y) => !occupied.some(other => overlapsCard({ x, y }, other))
  const candidates = []
  for (let dx = -8; dx <= 8; dx++) {
    for (let dy = -8; dy <= 8; dy++) {
      const manhattan = Math.abs(dx) + Math.abs(dy)
      if (manhattan === 0 || manhattan > 12) continue
      candidates.push({ dx, dy, score: manhattan + (dx < 0 ? .6 : 0) + (dy < 0 ? .4 : 0) })
    }
  }
  candidates.sort((a, b) => a.score - b.score || Math.abs(a.dy) - Math.abs(b.dy) || b.dx - a.dx)
  for (const { dx, dy } of candidates) {
    const x = Math.round(anchor.position.x + dx * stepX)
    const y = Math.max(82, Math.round(anchor.position.y + dy * stepY))
    if (free(x, y)) return { x, y }
  }
  return { x: Math.round(anchor.position.x + stepX), y: Math.max(82, Math.round(anchor.position.y)) }
}

function draftPlacement(cards) {
  const draft = state.draft
  if (draft === null || draft.kind === 'new') return null
  const parent = draft.anchorId === undefined
    ? cards.filter(card => card.dshThreadId === draft.parentId).at(-1)
    : cards.find(card => card.id === draft.anchorId)
  if (parent === undefined) return null
  return { parent, position: besideCardPosition(parent, cards.map(card => card.position)) }
}

function draftCard(cards) {
  const draft = state.draft
  if (draft?.kind === 'new') return `<article class="thread-card draft-card first-session-card" data-card-id="draft" style="left:86px;top:82px;--thread-color:#3478f6">
    <div class="thread-card-head"><span class="topic-dot"></span><strong>新会话</strong></div>
    <form class="draft-branch-form" data-draft><textarea maxlength="4000" placeholder="输入第一条消息" ${draft.sending ? 'disabled' : ''}>${escapeHtml(draft.text)}</textarea>${draftAttachments(draft)}${draftActions(draft)}</form>
  </article>`
  const placement = draftPlacement(cards)
  if (draft === null || placement === null) return ''
  const continuing = draft.kind === 'continue'
  return `<article class="thread-card draft-card" data-card-id="draft" style="left:${placement.position.x}px;top:${placement.position.y}px;--thread-color:#3478f6">
    <div class="thread-card-head"><span class="topic-dot"></span><strong>${continuing ? '新的追问' : '新的分支'}</strong></div>
    <form class="draft-branch-form" data-draft>${draftQuickPhrases(draft)}<textarea maxlength="4000" placeholder="${continuing ? '输入追问' : '输入这个分支的新问题'}" ${draft.sending ? 'disabled' : ''}>${escapeHtml(draft.text)}</textarea>${draftAttachments(draft)}${draftActions(draft)}</form>
  </article>`
}

function selectionFollowupButton() {
  return `<button class="selection-followup" type="button" data-action="follow-selection" hidden aria-label="基于所选内容创建追问" title="基于所选内容追问"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M3 3.5h10v6.25H7.2L4 12.5V9.75H3Z"/><path d="M8 4.9v3.4M6.3 6.6h3.4"/></svg><span>追问</span></button>`
}

// Cards are mounted into the DOM only when they intersect the viewport
// (inflated by VIEWPORT_MARGIN) in world coordinates. The camera transform is
// translate(camera) scale(zoom), so screen = world * zoom + camera.
function visibleCardIds(cards) {
  const viewport = document.querySelector('.canvas-viewport')
  if (!(viewport instanceof HTMLElement)) return new Set(cards.map(card => card.id))
  const bounds = viewport.getBoundingClientRect()
  const left = (-state.canvasCamera.x - VIEWPORT_MARGIN) / state.zoom
  const right = (bounds.width - state.canvasCamera.x + VIEWPORT_MARGIN) / state.zoom
  const top = (-state.canvasCamera.y - VIEWPORT_MARGIN) / state.zoom
  const bottom = (bounds.height - state.canvasCamera.y + VIEWPORT_MARGIN) / state.zoom
  const visible = new Set()
  for (const card of cards) {
    const { x, y } = card.position
    if (x + CARD_WIDTH < left || x > right || y + CARD_HEIGHT < top || y > bottom) continue
    visible.add(card.id)
  }
  return visible
}

// Incrementally mount cards entering the viewport and unmount cards leaving
// it, without rebuilding the canvas. Called after pan/zoom/focus camera moves.
function syncCanvasViewport() {
  if (state.mode !== 'canvas' || state.canvasCards === undefined) return
  const layer = document.querySelector('.cards-layer')
  if (!(layer instanceof HTMLElement)) return
  const visible = visibleCardIds(state.canvasCards)
  for (const cardId of [...state.mountedCardIds]) {
    if (visible.has(cardId)) continue
    const element = layer.querySelector(`[data-card-id="${selectorValue(cardId)}"]`)
    if (element instanceof HTMLElement) element.remove()
    state.mountedCardIds.delete(cardId)
  }
  for (const card of state.canvasCards) {
    if (!visible.has(card.id) || state.mountedCardIds.has(card.id)) continue
    const wrapper = document.createElement('div')
    wrapper.innerHTML = conversationCard(card, state.canvasGraph)
    const element = wrapper.firstElementChild
    if (element instanceof HTMLElement) {
      layer.appendChild(element)
      const handle = element.querySelector('[data-drag-card]')
      if (handle instanceof HTMLElement) bindDragHandle(handle)
      const port = element.querySelector('[data-connect-from]')
      if (port instanceof HTMLElement) bindConnectPort(port)
    }
    state.mountedCardIds.add(card.id)
  }
}

function folderTreeHtml(parentId, depth) {
  return childFoldersOf(parentId).map(folder => {
    const children = childFoldersOf(folder.id)
    return `<button class="tree-row folder-tree-row" style="padding-left:${6 + depth * 12}px" data-action="open-folder" data-folder="${escapeHtml(folder.id)}"><span class="tree-dot folder-dot"></span><span>${escapeHtml(folder.name)}</span>${children.length > 0 ? `<i>${children.length}</i>` : ''}</button>${folderTreeHtml(folder.id, depth + 1)}`
  }).join('')
}

function hiddenPanel() {
  if (!state.hiddenPanelOpen || state.hiddenCards.size === 0) return ''
  const rows = [...state.hiddenCards.entries()].map(([id, info]) => `<div class="hidden-row"><span title="${escapeHtml(info.question)}">${escapeHtml(info.question || '未命名卡片')}</span><button type="button" data-action="restore-card" data-card="${escapeHtml(id)}">恢复</button></div>`).join('')
  return `<aside class="hidden-panel" aria-label="已隐藏卡片"><header><strong>已隐藏卡片</strong><button type="button" data-action="close-hidden" aria-label="关闭" title="关闭">×</button></header><div class="hidden-panel-list">${rows}</div></aside>`
}

function renderCanvas() {
  const threads = state.workspace?.threads ?? []
  if (threads.length === 0 && state.draft?.kind !== 'new') return `<section class="empty-canvas"><strong>当前工作目录还没有 DSH 对话。</strong><p>点击新会话，在画布中输入第一条消息。</p><div><button class="primary" type="button" data-action="create-session">新建会话</button></div></section>`
  const allCards = conversationCards(threads)
  const graph = conversationGraphView(allCards)
  const visibleCards = graph.cards.filter(card => !state.hiddenCards.has(card.id))
  const viewFolderId = state.viewFolderId
  const cardById = new Map(visibleCards.map(card => [card.id, card]))
  const folders = childFoldersOf(viewFolderId)
  const owned = visibleCards.filter(card => containerOfCardKey(cardKeyOf(card)) === viewFolderId)

  // Edges for this view: internal links stay; links that cross the folder
  // boundary aggregate onto the folder card (main view) or point at the greyed
  // external card (folder view).
  const mapEndpoint = id => {
    if (typeof id === 'string' && id.startsWith('folder:')) {
      const folder = state.folders.get(id.slice(7))
      if (folder === undefined) return null
      if (folder.parentId === viewFolderId) return { key: `folder:${folder.id}`, kind: 'folder', position: folder.position }
      const child = folderChildOfView(folder.parentId, viewFolderId)
      const childFolder = child === null ? undefined : state.folders.get(child)
      return childFolder === undefined ? null : { key: `folder:${child}`, kind: 'folder', position: childFolder.position }
    }
    const card = cardById.get(id)
    if (card === undefined) return null
    const container = containerOfCardKey(cardKeyOf(card))
    if (container === viewFolderId) return { key: card.id, kind: 'card', position: card.position }
    // A card in a deeper folder is aggregated onto that folder's card in this
    // view (exactly like the main canvas aggregates onto folder cards).
    const child = folderChildOfView(container, viewFolderId)
    const childFolder = child === null ? undefined : state.folders.get(child)
    return childFolder === undefined ? null : { key: `folder:${child}`, kind: 'folder', position: childFolder.position }
  }
  const viewEdges = []
  const edgeIndexByDedupe = new Map()
  const contextById = new Map()
  const contextFolderKeys = new Set()
  for (const edge of conversationEdges(visibleCards)) {
    const from = mapEndpoint(edge.from)
    const to = mapEndpoint(edge.to)
    if (from === null || to === null || from.key === to.key) continue
    // Folder pages show only their own level: no greyed-out external context.
    if (viewFolderId !== null && (from.kind.startsWith('context') || to.kind.startsWith('context'))) continue
    const dedupe = `${from.key}|${to.key}|${edge.custom ? 1 : 0}`
    const existing = edgeIndexByDedupe.get(dedupe)
    if (existing !== undefined) { existing.keys.push(edge.key); continue }
    const item = { from, to, custom: edge.custom, keys: [edge.key] }
    edgeIndexByDedupe.set(dedupe, item)
    viewEdges.push(item)
    for (const endpoint of [from, to]) {
      if (endpoint.kind === 'context') {
        const card = cardById.get(endpoint.key)
        if (card !== undefined) contextById.set(card.id, card)
      } else if (endpoint.kind === 'context-folder') {
        contextFolderKeys.add(endpoint.key)
      }
    }
  }
  const contextCards = [...contextById.values()]
  const contextFolders = [...contextFolderKeys].map(key => state.folders.get(key.slice(7))).filter(folder => folder !== undefined)

  state.canvasCards = owned
  state.canvasCardsById = new Map(owned.map(card => [card.id, card]))
  state.canvasGraph = graph
  state.canvasFolders = folders
  state.canvasContext = contextCards
  state.canvasContextFolders = contextFolders
  state.viewEdges = viewEdges
  const nodesById = new Map()
  for (const card of owned) nodesById.set(card.id, card)
  for (const card of contextCards) nodesById.set(card.id, card)
  for (const folder of folders) nodesById.set(`folder:${folder.id}`, folder)
  for (const folder of contextFolders) nodesById.set(`folder:${folder.id}`, folder)
  for (const edge of viewEdges) for (const endpoint of [edge.from, edge.to]) if (!nodesById.has(endpoint.key)) nodesById.set(endpoint.key, { id: endpoint.key, position: endpoint.position })
  state.viewNodesById = nodesById

  if (state.inspectorCardId !== null && !state.canvasCardsById.has(state.inspectorCardId)) {
    state.inspectorCardId = null
    state.inspectorOpening = false
  }
  if (!state.canvasViewInitialized) {
    state.canvasCamera = initialCanvasCamera(owned)
    state.canvasViewInitialized = true
    // The viewport is not laid out yet while renderCanvas builds its HTML;
    // center the focused card once the DOM is mounted (render tail).
    state.canvasNeedsCenter = true
  }
  const visible = visibleCardIds(owned)
  state.mountedCardIds = new Set(visible)
  const mounted = owned.filter(card => visible.has(card.id))
  const inspector = state.inspectorCardId === null ? '' : renderCardInspector(state.canvasCardsById.get(state.inspectorCardId))
  const layer = [
    ...mounted.map(card => conversationCard(card, graph)),
    ...folders.map(folder => folderCardHtml(folder)),
    ...contextCards.map(card => contextCardHtml(card)),
    ...contextFolders.map(folder => contextFolderHtml(folder)),
  ].join('')
  const folderBar = viewFolderId === null ? '' : `<div class="folder-view-bar"><button type="button" class="primary" data-action="folder-back">← 返回</button><strong>${escapeHtml(state.folders.get(viewFolderId)?.name ?? '文件夹')}</strong><span>${state.folderCards.get(viewFolderId)?.size ?? 0} 张卡片${folders.length > 0 ? `，${folders.length} 个子文件夹` : ''}</span></div>`
  const emptyFolder = viewFolderId !== null && owned.length === 0 && folders.length === 0 ? '<p class="folder-empty">这个文件夹是空的。把卡片拖进来，或在文件夹里新建。</p>' : ''
  return `<section class="canvas-view">${folderBar}<div class="canvas-viewport"><div class="canvas-content" style="transform:translate(${state.canvasCamera.x}px, ${state.canvasCamera.y}px) scale(${state.zoom})"><svg class="connectors">${viewConnectorSvg(viewEdges)}</svg><div class="cards-layer">${layer}${draftCard(owned)}${emptyFolder}</div></div></div>${inspector}${hiddenPanel()}</section>`
}

function viewConnectorSvg(edges) {
  const nodes = state.viewNodesById
  return edges.map(edge => {
    const from = nodes.get(edge.from.key)
    const to = nodes.get(edge.to.key)
    if (from === undefined || to === undefined) return ''
    const custom = edge.custom ? ' custom-connector' : ''
    const fromSide = (to.position.x + CARD_WIDTH / 2) >= (from.position.x + CARD_WIDTH / 2) ? 'right' : 'left'
    const toSide = fromSide === 'right' ? 'left' : 'right'
    const path = connectorPathSides(from.position, fromSide, to.position, toSide)
    const keys = Array.isArray(edge.keys) ? edge.keys : []
    const edgeAttr = keys.length > 0 ? ` data-edges="${escapeHtml(JSON.stringify(keys))}"` : ''
    const title = keys.length > 0 ? '<title>点击删除这条连线</title>' : ''
    const sideAttr = ` data-from-side="${fromSide}" data-to-side="${toSide}"`
    return `<g class="edge-group${custom}"${edgeAttr}>${title}<path class="edge-hit" data-from="${escapeHtml(edge.from.key)}" data-to="${escapeHtml(edge.to.key)}"${sideAttr} d="${path}"></path><path class="edge-path${custom}" data-from="${escapeHtml(edge.from.key)}" data-to="${escapeHtml(edge.to.key)}"${sideAttr} d="${path}"></path></g>`
  }).join('')
}

function folderCardHtml(folder) {
  const count = state.folderCards.get(folder.id)?.size ?? 0
  const children = childFoldersOf(folder.id).length
  return `<article class="thread-card folder-card${lockGroupOf(`folder:${folder.id}`) !== null ? ' group-locked' : ''}" data-folder-id="${escapeHtml(folder.id)}" style="left:${folder.position.x}px;top:${folder.position.y}px">
    <button class="node-handle" data-drag-folder="${escapeHtml(folder.id)}" title="拖动文件夹"></button>
    <button class="edge-port port-left" data-connect-from="folder:${escapeHtml(folder.id)}" data-connect-side="left" aria-label="从左侧拖出连线" title="从左侧拖出连线"></button>
    <button class="edge-port port-right" data-connect-from="folder:${escapeHtml(folder.id)}" data-connect-side="right" aria-label="从右侧拖出连线" title="从右侧拖出连线"></button>
    <div class="thread-card-head"><span class="folder-glyph">📁</span><button class="folder-title" data-action="open-folder" data-folder="${escapeHtml(folder.id)}" title="打开文件夹">${escapeHtml(folder.name)}</button></div>
    <div class="folder-meta">${count} 张卡片${children > 0 ? ` · ${children} 个子文件夹` : ''}</div>
    <div class="folder-hint">左键打开 · 可拖到别的文件夹上收纳</div>
    <footer><button data-action="rename-folder" data-folder="${escapeHtml(folder.id)}" title="重命名文件夹">重命名</button><button data-action="dissolve-folder" data-folder="${escapeHtml(folder.id)}" title="解散（卡片回到上一层）">解散</button></footer>
  </article>`
}

function contextFolderHtml(folder) {
  const count = state.folderCards.get(folder.id)?.size ?? 0
  return `<article class="thread-card context-card folder-context-card" data-context-folder="${escapeHtml(folder.id)}" style="left:${folder.position.x}px;top:${folder.position.y}px"><div class="thread-card-head"><span class="folder-glyph">📁</span><strong class="context-title">${escapeHtml(folder.name)}</strong></div><div class="folder-meta">外部文件夹 · ${count} 张卡片</div></article>`
}

function contextCardHtml(card) {
  return `<article class="thread-card context-card" data-context-card="${escapeHtml(card.id)}" style="left:${card.position.x}px;top:${card.position.y}px"><div class="thread-card-head"><span class="topic-dot"></span><strong class="context-title">${escapeHtml(card.question)}</strong></div><div class="folder-meta">外部卡片 · 只读</div></article>`
}

function isProcessMessage(message) {
  if (message.kind === 'tool' || message.kind === 'tool-result') return true
  return message.kind === 'assistant' && /(?:^|\n)\s*(?:bash|pwsh|powershell|web_search|web_fetch|browser|read_file|write_file)\s*\n\s*\{/.test(message.text)
}

function processSummary(text) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 140) || '工具调用记录'
}

function threadMessage(thread, message) {
  const isUser = message.kind === 'user'
  const label = isUser ? '你' : message.kind === 'assistant' ? 'DSH' : message.kind === 'error' ? '错误' : '记录'
  const branch = message.kind === 'assistant' && Number.isInteger(message.sourceSeq)
    ? `<button class="message-branch" data-action="open-branch" data-thread="${thread.id}" data-seq="${message.sourceSeq}" title="从此回答创建分支"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M4.5 3v6a2.5 2.5 0 0 0 2.5 2.5H12"/><circle cx="4.5" cy="3" r="1.5"/><circle cx="11.5" cy="12" r="1.5"/></svg>分支</button>`
    : ''
  const messageId = `${thread.id}:${message.sourceSeq ?? `${message.kind}:${message.at}`}`
  const collapsible = isProcessMessage(message)
  const expanded = state.expandedMessageIds.has(messageId)
  const fold = collapsible ? `<button class="message-fold" data-action="toggle-message" data-message="${escapeHtml(messageId)}" aria-label="${expanded ? '收起过程记录' : '展开过程记录'}" title="${expanded ? '收起' : '展开'}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5"/></svg></button>` : ''
  const process = Array.isArray(message.process) && message.process.length > 0 ? message.process : null
  const body = message.pending && message.text === '' ? '<p class="message-streaming"><span class="streaming-dot"></span>正在回复</p>'
    : `${collapsible && !expanded ? `<p class="message-summary">${escapeHtml(processSummary(message.text))}</p>` : renderMarkdown(message.text)}${message.pending ? '<p class="message-streaming"><span class="streaming-dot"></span>正在回复</p>' : ''}${process === null ? '' : processRecords(process, messageId)}`
  const avatar = isUser ? '' : '<span class="message-avatar" aria-hidden="true"></span>'
  return `<article class="message message-${message.kind}${message.pending ? ' message-pending' : ''}${collapsible ? ' message-collapsible' : ''}${expanded ? ' expanded' : ''}" data-message-seq="${Number.isInteger(message.sourceSeq) ? message.sourceSeq : ''}"><header>${avatar}<span class="message-role">${label}</span><time>${formatTime(message.at)}</time>${branch}${fold}</header><div class="message-body">${body}</div></article>`
}

function processRecords(process, messageId) {
  const key = `${messageId}:process`
  const expanded = state.expandedMessageIds.has(key)
  const entries = process.map((entry, index) => {
    const entryKey = `${key}:${index}`
    const entryExpanded = state.expandedMessageIds.has(entryKey)
    const status = entry.error !== null ? '失败' : entry.result === null ? '等待结果' : '完成'
    const argumentsHtml = entry.arguments === null || entry.arguments === '' ? '' : `<pre class="process-args">${escapeHtml(entry.arguments)}</pre>`
    const outcomeHtml = entry.error !== null ? `<pre class="process-error">${escapeHtml(entry.error)}</pre>` : entry.result === null ? '' : `<pre class="process-result">${escapeHtml(entry.result)}</pre>`
    return `<div class="process-entry${entryExpanded ? ' expanded' : ''}"><button class="process-entry-fold" data-action="toggle-message" data-message="${escapeHtml(entryKey)}"><span class="process-entry-name">${escapeHtml(entry.name)}</span><span class="process-status${entry.error !== null ? ' process-status-error' : entry.result === null ? ' process-status-pending' : ' process-status-done'}">${status}</span></button>${entryExpanded ? `<div class="process-entry-body">${argumentsHtml}${outcomeHtml}</div>` : ''}</div>`
  }).join('')
  return `<section class="process-records${expanded ? ' expanded' : ''}"><button class="process-records-fold" data-action="toggle-message" data-message="${escapeHtml(key)}"><span>${expanded ? '收起过程记录' : '过程记录'}</span><span class="process-count">${process.length}</span></button>${expanded ? entries : ''}</section>`
}

function messagesForCard(card) {
  const thread = state.workspace?.threads.find(item => item.id === card.dshThreadId)
  if (thread === undefined) return { thread: null, messages: [] }
  const messages = messagesFor(thread)
  let turnIndex = -1
  let start = -1
  for (let index = 0; index < messages.length; index++) {
    if (messages[index].kind !== 'user') continue
    turnIndex += 1
    if (turnIndex === card.turnIndex) {
      start = index
      break
    }
  }
  if (start === -1) return { thread, messages: [] }
  const end = messages.findIndex((message, index) => index > start && message.kind === 'user')
  return { thread, messages: messages.slice(start, end === -1 ? undefined : end) }
}

function inspectorProcessEntries(messages) {
  const entries = []
  for (const message of messages) {
    if (Array.isArray(message.process)) {
      entries.push(...message.process.map(entry => ({ ...entry })))
      continue
    }
    if (message.kind === 'tool') {
      entries.push({ name: processSummary(message.text), arguments: message.text, result: null, error: null })
      continue
    }
    if (message.kind === 'tool-result') {
      const previous = entries.at(-1)
      if (previous !== undefined && previous.result === null && previous.error === null) previous.result = message.text
      else entries.push({ name: '工具结果', arguments: null, result: message.text, error: null })
    }
  }
  return entries
}

function renderCardInspector(card) {
  if (card === undefined) return ''
  const { thread, messages } = messagesForCard(card)
  if (thread === null) return ''
  const process = inspectorProcessEntries(messages)
  const answer = card.answer === null
    ? card.error === null ? '<p class="card-inspector-pending">等待助手回复</p>' : ''
    : `<article class="card-inspector-answer">${renderMarkdown(card.answer.text)}${card.answer.pending ? '<p class="card-inspector-pending">正在回复</p>' : ''}</article>`
  const error = card.error === null ? '' : `<section class="card-inspector-error" role="alert"><strong>本轮未完成</strong><p>${escapeHtml(card.error.text)}</p></section>`
  const processRecordsHtml = process.length === 0 ? '' : processRecords(process, `${thread.id}:${card.id}:inspector`)
  const continueAction = card.canContinue === true ? `<button type="button" data-action="open-continue" data-thread="${thread.id}" data-card="${escapeHtml(card.id)}"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M2.5 3.5h11v7h-6l-3.5 2.5v-2.5h-1.5Z"/><path d="M8 5.5v3M6.5 7h3"/></svg>继续追问</button>` : ''
  const branch = Number.isInteger(card.answer?.sourceSeq)
    ? `<button type="button" data-action="open-branch" data-thread="${thread.id}" data-card="${escapeHtml(card.id)}" data-seq="${card.answer.sourceSeq}"><svg aria-hidden="true" viewBox="0 0 16 16"><circle cx="4" cy="3.5" r="1.5"/><circle cx="12" cy="3.5" r="1.5"/><circle cx="12" cy="12.5" r="1.5"/><path d="M5.5 3.5h2A2.5 2.5 0 0 1 10 6v5"/></svg>创建分支</button>`
    : ''
  const openDshAction = `<button class="primary" type="button" data-action="open-dsh" data-thread="${thread.id}" data-seq="${Number.isInteger(card.answer?.sourceSeq) ? card.answer.sourceSeq : ''}"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M7 3.5H4.5A1.5 1.5 0 0 0 3 5v6.5A1.5 1.5 0 0 0 4.5 13H11a1.5 1.5 0 0 0 1.5-1.5V9"/><path d="M9.5 3.5h3v3M12.4 3.6 7.5 8.5"/></svg>在 DSH 中打开</button>`
  return `<aside class="card-inspector${state.inspectorOpening ? ' is-opening' : ''}" aria-label="卡片详情" data-inspector-card="${escapeHtml(card.id)}"${state.inspectorWidth > 0 ? ` style="width:${state.inspectorWidth}px"` : ''}><div class="card-inspector-resize" data-resize-inspector title="拖动调整宽度"></div><header class="card-inspector-head"><div><div class="card-inspector-meta"><span>第 ${card.turnIndex + 1} 轮</span>${card.error === null ? '' : '<span class="card-inspector-error-status">失败</span>'}${process.length > 0 ? `<span>工具 ${process.length}</span>` : ''}</div><h2>${escapeHtml(card.question)}</h2></div><button class="card-inspector-close" type="button" data-action="close-card-inspector" aria-label="关闭卡片详情" title="关闭"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg></button></header><div class="card-inspector-scroll">${error}${answer}${processRecordsHtml}</div><footer class="card-inspector-actions">${continueAction}${branch}${openDshAction}</footer></aside>`
}

function renderThread() {
  const thread = currentThread()
  if (thread === null) return renderCanvas()
  const messages = messagesFor(thread)
  const waiting = state.pendingReplies.has(thread.dshSessionId)
  const latestAssistantSeq = [...messages].reverse().find(message => Number.isInteger(message.sourceSeq))?.sourceSeq
  return `<section class="detail-view"><header class="detail-head"><div class="detail-head-title"><div class="detail-head-meta"><span class="detail-badge">${thread.parentId === null ? '会话' : '分支'}</span>${thread.dshSessionTitle ?? thread.title ? `<span class="detail-subtitle">${escapeHtml(thread.dshSessionTitle ?? thread.title)}</span>` : ''}</div><h1>${escapeHtml(questionFor(thread))}</h1></div><div class="detail-head-actions"><button data-action="open-dsh" data-thread="${thread.id}" data-seq="${Number.isInteger(latestAssistantSeq) ? latestAssistantSeq : ''}" title="在原生对话中打开此会话">在 DSH 中打开</button><button data-action="open-branch" data-thread="${thread.id}" title="基于最新回答创建分支">创建分支</button><button class="primary" data-action="show-canvas">返回画布</button></div></header><div class="detail-scroll">${messages.map(message => threadMessage(thread, message)).join('') || '<div class="note-empty">等待这条会话的第一条消息。</div>'}</div><form class="message-composer" data-compose="${thread.id}"><textarea maxlength="4000" placeholder="继续当前会话…" ${waiting ? 'disabled' : ''}></textarea><button class="primary" type="submit" ${waiting ? 'disabled' : ''}>${waiting ? '等待回复' : '发送'}</button></form></section>`
}

function render() {
  // Remember the departing thread's scroll position per thread id, so
  // switching sessions restores each conversation's own place instead of
  // smearing one session's position onto another.
  if (state.mode === 'thread' && state.detailThreadId !== null) {
    const detail = document.querySelector('.detail-scroll')
    if (detail instanceof HTMLElement) state.detailScrollByThread.set(state.detailThreadId, detail.scrollTop)
  }
  if (state.mode === 'canvas' && state.inspectorCardId !== null) {
    const inspector = document.querySelector('.card-inspector-scroll')
    if (inspector instanceof HTMLElement) state.inspectorScrollByCard.set(state.inspectorCardId, inspector.scrollTop)
  }
  state.detailThreadId = state.mode === 'thread' ? state.activeId : null
  const detailScrollTop = state.detailThreadId === null ? null : state.detailScrollByThread.get(state.detailThreadId) ?? null
  const inspectorScrollTop = state.mode === 'canvas' && state.inspectorCardId !== null ? state.inspectorScrollByCard.get(state.inspectorCardId) ?? null : null
  const cardScrollTops = new Map()
  const folderTreeScrollTop = (() => { const tree = document.querySelector('.folder-tree'); return tree instanceof HTMLElement ? tree.scrollTop : 0 })()
  if (state.mode === 'canvas') {
    // Key by the unique card id: every card of a session shares data-thread,
    // so keying on it would clobber sibling cards' scroll positions. Only
    // scrollable answers have a position worth preserving; reading the two
    // height properties shares the same forced layout as the scrollTop read.
    for (const answer of document.querySelectorAll('.thread-card[data-thread] .thread-answer')) {
      if (answer.scrollHeight <= answer.clientHeight) continue
      const card = answer.closest('.thread-card')
      if (card instanceof HTMLElement && typeof card.dataset.cardId === 'string') cardScrollTops.set(card.dataset.cardId, answer.scrollTop)
    }
  }
  const workspace = state.workspace
  const threads = workspace?.threads ?? []
  const view = state.mode === 'thread' ? renderThread() : renderCanvas()
  const choices = workspaceChoices()
  const selectedWorkspaceId = state.selectedDshWorkspaceId ?? workspace?.id
  const canvasControls = state.mode === 'canvas' && (threads.length > 0 || state.draft?.kind === 'new') ? `<div class="canvas-controls"><button data-action="undo" title="撤销 (Ctrl+Z)" aria-label="撤销" ${canvasHistory.past.length === 0 ? 'disabled' : ''}><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 4.5 3 8l3.5 3.5"/><path d="M3 8h6.5a3.5 3.5 0 0 1 0 7H7"/></svg></button><button data-action="redo" title="重做 (Ctrl+Y)" aria-label="重做" ${canvasHistory.future.length === 0 ? 'disabled' : ''}><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 4.5 13 8l-3.5 3.5"/><path d="M13 8H6.5a3.5 3.5 0 0 0 0 7H9"/></svg></button><button data-action="toggle-hidden" class="${state.hiddenPanelOpen ? 'active' : ''}" title="已隐藏卡片" ${state.hiddenCards.size === 0 ? 'hidden' : ''}>已隐藏 ${state.hiddenCards.size}</button><button data-action="export-canvas" title="导出 Obsidian Canvas">导出</button><button data-action="focus-active" title="定位到当前会话" aria-label="定位到当前会话"><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="8" cy="8" r="3.2"/><path d="M8 1.5v2.6M8 11.9v2.6M1.5 8h2.6M11.9 8h2.6"/></svg>定位</button><button data-action="zoom-out" aria-label="缩小" title="缩小"><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M3.5 8h9"/></svg></button><span>${Math.round(state.zoom * 100)}%</span><button data-action="zoom-in" aria-label="放大" title="放大"><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M8 3.5v9M3.5 8h9"/></svg></button></div>` : ''
  const detailAvailable = currentThread() !== null
  const canvasTabs = `<nav class="canvas-tabs" aria-label="会话地图视图"><button class="${state.mode === 'canvas' ? 'active' : ''}" data-action="show-canvas">地图</button><button class="${state.mode === 'thread' ? 'active' : ''}" data-action="show-thread" data-thread="${state.activeId ?? ''}" ${detailAvailable ? '' : 'disabled'}>详情</button></nav>`
  const folderTree = childFoldersOf(null).length === 0 ? '' : `<div class="sidebar-heading"><span>文件夹</span></div><nav class="folder-tree">${folderTreeHtml(null, 0)}</nav>`
  const hiddenEntries = [...state.hiddenCards.entries()]
  const hiddenSection = hiddenEntries.length === 0 || state.sidebarCollapsed ? '' : `<div class="sidebar-heading hidden-heading"><span>已隐藏卡片</span><span class="hidden-count">${hiddenEntries.length}</span></div><nav class="hidden-list">${hiddenEntries.map(([id, info]) => `<div class="hidden-row"><span title="${escapeHtml(info.question)}">${escapeHtml(info.question || '未命名卡片')}</span><button type="button" data-action="restore-card" data-card="${escapeHtml(id)}">恢复</button></div>`).join('')}</nav>`
  app.innerHTML = `<main class="synapse-shell ${state.sidebarCollapsed ? 'sidebar-collapsed' : ''}"><aside class="sidebar"><div class="sidebar-brand-row"><div class="brand" aria-label="Synapse"><svg class="brand-mark" aria-hidden="true" viewBox="0 0 32 32" fill="none"><path d="M9 10.5 16 7l7 3.5M9 10.5v8L16 22m0-15v15m7-11.5v8L16 22"/><circle cx="9" cy="10" r="2.5"/><circle cx="23" cy="10" r="2.5"/><circle cx="16" cy="23" r="2.5"/></svg><strong>Synapse</strong></div><button class="sidebar-toggle" type="button" data-action="toggle-sidebar" aria-label="${state.sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}" title="${state.sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.75" y="1.75" width="12.5" height="12.5" rx="2.25"/><path d="M6 2v12"/></svg></button></div><button class="new-workspace" type="button" data-action="create-session" ${state.draft !== null ? 'disabled' : ''}><svg class="new-session-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.25"/><path d="M8 4.75v6.5M4.75 8h6.5"/></svg><span>新会话</span></button><label class="workspace-label"><span>工作区</span><span class="workspace-select"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M2.5 4.75h3l1.2 1.5h6.8v5.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z"/></svg><select data-action="select-workspace" aria-label="选择工作区" ${state.draft !== null ? 'disabled' : ''}>${choices.map(item => `<option value="${item.id}" title="${escapeHtml(item.path ?? item.title)}" ${item.id === selectedWorkspaceId ? 'selected' : ''}>${escapeHtml(item.title)}</option>`).join('')}</select></span></label>${folderTree}${hiddenSection}</aside><header class="topbar"><div class="view-switch" role="group" aria-label="视图切换"><button data-action="close" type="button" aria-pressed="false">对话</button><button class="active" type="button" aria-pressed="true">会话地图</button></div>${canvasControls}</header><section class="main-stage">${state.error ? `<div class="status-message" role="alert"><span>${escapeHtml(state.error)}</span><button data-action="dismiss-error" aria-label="关闭" title="关闭">×</button></div>` : ''}${canvasTabs}${view}${selectionFollowupButton()}</section></main>`
  installDragging()
  applyShortcutTitles()
  cacheCardConnectors()
  // The initial camera from renderCanvas is inset (viewport not laid out yet);
  // center it on the focused card once the canvas DOM is mounted.
  if (state.canvasNeedsCenter) {
    state.canvasNeedsCenter = false
    window.requestAnimationFrame(() => { if (state.mode === 'canvas') focusActiveCard() })
  }
  if (state.canvasNeedsFit && state.mode === 'canvas') {
    window.requestAnimationFrame(() => {
      if (state.mode !== 'canvas') return
      if (fitCanvasToItems()) state.canvasNeedsFit = false
    })
  }
  for (const [cardId, scrollTop] of cardScrollTops) {
    const answer = app.querySelector(`.thread-card[data-card-id="${CSS.escape(cardId)}"] .thread-answer`)
    if (answer instanceof HTMLElement) answer.scrollTop = scrollTop
  }
  if (folderTreeScrollTop > 0) {
    const tree = document.querySelector('.folder-tree')
    if (tree instanceof HTMLElement) tree.scrollTop = folderTreeScrollTop
  }
  if (detailScrollTop !== null) window.requestAnimationFrame(() => {
    const nextDetail = document.querySelector('.detail-scroll')
    if (nextDetail instanceof HTMLElement) nextDetail.scrollTop = detailScrollTop
  })
  if (inspectorScrollTop !== null) window.requestAnimationFrame(() => {
    const inspector = document.querySelector('.card-inspector-scroll')
    if (inspector instanceof HTMLElement) inspector.scrollTop = inspectorScrollTop
  })
  if (state.inspectorOpening) window.requestAnimationFrame(() => {
    document.querySelector('.card-inspector')?.classList.remove('is-opening')
    state.inspectorOpening = false
  })
  // Jump the detail view to the card the user clicked: card ids carry the
  // source sequence (`<thread>:turn:<seq>`), which matches data-message-seq
  // anchors on the rendered messages.
  const targetCardId = state.detailTargetCardId
  state.detailTargetCardId = null
  if (targetCardId !== null) {
    const match = /:turn:(\d+)$/.exec(targetCardId)
    const seq = match === null ? null : match[1]
    if (seq !== null) window.requestAnimationFrame(() => {
      const target = app.querySelector(`[data-message-seq="${CSS.escape(seq)}"]`)
      if (target instanceof HTMLElement) target.scrollIntoView({ block: 'start' })
    })
  }
}

function renderPreservingDetailScroll() {
  render()
}

let inspectorCloseTimer = 0
function openCardInspector(cardId) {
  if (inspectorCloseTimer !== 0) {
    window.clearTimeout(inspectorCloseTimer)
    inspectorCloseTimer = 0
  }
  state.inspectorOpening = state.inspectorCardId === null
  state.inspectorCardId = cardId
}

function closeCardInspector({ animate = true } = {}) {
  if (state.inspectorCardId === null) return
  if (inspectorCloseTimer !== 0) window.clearTimeout(inspectorCloseTimer)
  const cardId = state.inspectorCardId
  const inspector = document.querySelector('.card-inspector')
  if (!animate || !(inspector instanceof HTMLElement)) {
    state.inspectorCardId = null
    state.inspectorOpening = false
    render()
    return
  }
  inspector.classList.add('is-closing')
  inspectorCloseTimer = window.setTimeout(() => {
    inspectorCloseTimer = 0
    if (state.inspectorCardId !== cardId) return
    state.inspectorCardId = null
    state.inspectorOpening = false
    render()
  }, 180)
}

function applyCanvasTransform() {
  const content = document.querySelector('.canvas-content')
  if (content instanceof HTMLElement) content.style.transform = `translate(${state.canvasCamera.x}px, ${state.canvasCamera.y}px) scale(${state.zoom})`
}

function bindDragHandle(handle) {
  handle.addEventListener('pointerdown', event => {
    const cardId = event.currentTarget.dataset.dragCard
    const card = event.currentTarget.closest('.thread-card')
    if (cardId === undefined || !(card instanceof HTMLElement)) return
    event.preventDefault()
    const data = state.canvasCardsById?.get(cardId)
    const key = data !== undefined ? cardKeyOf(data) : cardId
    let members
    if (lockGroupOf(key) !== null) {
      members = dragMembersFor(key)
    } else {
      // Dragging a card inside a marquee selection moves the whole selection
      // (cards plus folders).
      const selection = state.selectedCardIds.has(cardId) && (state.selectedCardIds.size + state.selectedFolderIds.size > 1)
      if (selection) {
        members = selectionDragMembers()
      } else {
        if (state.selectedCardIds.size > 0 || state.selectedFolderIds.size > 0) {
          state.selectedCardIds = new Set()
          state.selectedFolderIds = new Set()
          for (const el of app.querySelectorAll('.group-selected')) el.classList.remove('group-selected')
        }
        const memberData = state.canvasCardsById?.get(cardId)
        const element = app.querySelector(`.thread-card[data-card-id="${selectorValue(cardId)}"]`)
        const initial = memberData?.position ?? (element instanceof HTMLElement ? { x: Number.parseFloat(element.style.left), y: Number.parseFloat(element.style.top) } : null)
        members = [{ kind: 'card', id: cardId, ref: memberData, element, initial }]
      }
    }
    members = members.filter(member => member.initial !== null && member.initial !== undefined && Number.isFinite(member.initial.x) && Number.isFinite(member.initial.y))
    if (members.length === 0) return
    state.dragging = true
    const origin = { x: event.clientX, y: event.clientY }
    let delta = { x: 0, y: 0 }
    let stopped = false
    let historyPushed = false
    let frame = 0
    let lastPointer = null
    let dropFolderId = null
    const folderUnder = (x, y) => {
      for (const el of app.querySelectorAll('.folder-card[data-folder-id]')) {
        if (!(el instanceof HTMLElement)) continue
        const r = el.getBoundingClientRect()
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
          const id = el.dataset.folderId
          if (id !== undefined && state.folders.has(id)) return id
        }
      }
      return null
    }
    const updateDropTarget = () => {
      const next = lastPointer === null ? null : folderUnder(lastPointer.x, lastPointer.y)
      if (next === dropFolderId) return
      if (dropFolderId !== null) {
        const prev = app.querySelector(`.folder-card[data-folder-id="${selectorValue(dropFolderId)}"]`)
        if (prev instanceof HTMLElement) prev.classList.remove('drop-target')
      }
      dropFolderId = next
      if (dropFolderId !== null) {
        const cur = app.querySelector(`.folder-card[data-folder-id="${selectorValue(dropFolderId)}"]`)
        if (cur instanceof HTMLElement) cur.classList.add('drop-target')
      }
    }
    const apply = () => {
      frame = 0
      for (const member of members) {
        const position = { x: Math.round(member.initial.x + delta.x), y: Math.round(member.initial.y + delta.y) }
        if (member.ref !== undefined) member.ref.position = { x: member.initial.x + delta.x, y: member.initial.y + delta.y }
        if (member.kind === 'card') {
          state.cardPositions.set(member.id, position)
          refreshCardConnectors(member.id)
        } else {
          refreshCardConnectors(`folder:${member.id}`)
        }
        if (member.element instanceof HTMLElement) {
          member.element.style.left = `${member.initial.x + delta.x}px`
          member.element.style.top = `${member.initial.y + delta.y}px`
        }
      }
      updateDropTarget()
    }
    const move = moveEvent => {
      lastPointer = { x: moveEvent.clientX, y: moveEvent.clientY }
      if (!historyPushed && Math.hypot(moveEvent.clientX - origin.x, moveEvent.clientY - origin.y) > 3) {
        historyPushed = true
        pushHistory()
      }
      delta = { x: (moveEvent.clientX - origin.x) / state.zoom, y: (moveEvent.clientY - origin.y) / state.zoom }
      if (frame === 0) frame = window.requestAnimationFrame(apply)
    }
    const stop = () => {
      if (stopped) return
      stopped = true
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', stop)
      document.removeEventListener('pointercancel', stop)
      if (frame !== 0) { window.cancelAnimationFrame(frame); frame = 0 }
      apply()
      updateDropTarget()
      const droppedFolderId = dropFolderId
      if (dropFolderId !== null) {
        const el = app.querySelector(`.folder-card[data-folder-id="${selectorValue(dropFolderId)}"]`)
        if (el instanceof HTMLElement) el.classList.remove('drop-target')
      }
      dropFolderId = null
      for (const member of members) {
        if (member.kind !== 'card') continue
        const aliases = typeof member.ref?.positionKey === 'string' ? [member.ref.positionKey] : []
        rememberCardPosition(member.id, { x: member.initial.x + delta.x, y: member.initial.y + delta.y }, aliases)
      }
      state.dragging = false
      if (droppedFolderId !== null && fileItems(members, droppedFolderId)) { render(); return }
      persistFolders()
      deferCanvasRefresh(120)
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', stop)
    document.addEventListener('pointercancel', stop)
  })
}

// The port drag ends with the pointer over another card, which also produces a
// click; swallow that click so it does not open the target's inspector.
let suppressNextClick = false

// Tab is used as a marquee modifier (fold), so track it and keep it from
// moving focus while the canvas is active.
let tabHeld = false
window.addEventListener('keydown', event => { if (event.key === 'Tab' && state.mode === 'canvas') { event.preventDefault(); tabHeld = true } })
window.addEventListener('keyup', event => { if (event.key === 'Tab') tabHeld = false })
window.addEventListener('blur', () => { tabHeld = false })

// Alt is the "lock relative positions" marquee modifier.
let altHeld = false
window.addEventListener('keydown', event => { if (event.key === 'Alt' && state.mode === 'canvas') { event.preventDefault(); altHeld = true } })
window.addEventListener('keyup', event => { if (event.key === 'Alt') altHeld = false })
window.addEventListener('blur', () => { altHeld = false })

// Drag from a card's edge port to another card to draw a hand-made link.
function bindConnectPort(port) {
  port.addEventListener('pointerdown', event => {
    if (event.button !== 0) return
    const fromId = port.dataset.connectFrom
    const fromNode = fromId === undefined ? undefined : state.viewNodesById?.get(fromId)
    if (fromId === undefined || fromNode === undefined) return
    const fromSide = port.dataset.connectSide === 'left' ? 'left' : 'right'
    event.preventDefault()
    event.stopPropagation()
    const svg = document.querySelector('.canvas-content .connectors')
    const live = svg instanceof Element ? document.createElementNS('http://www.w3.org/2000/svg', 'path') : null
    if (live !== null && svg instanceof Element) {
      live.setAttribute('class', 'live-connector')
      svg.appendChild(live)
    }
    let target = null
    let pointer = null
    let frame = 0
    const hoverTarget = (clientX, clientY) => {
      const element = document.elementFromPoint(clientX, clientY)
      if (!(element instanceof Element)) return null
      const card = element.closest('.thread-card[data-card-id]:not(.draft-card)')
      if (card instanceof HTMLElement) {
        const id = card.dataset.cardId
        return id === undefined || id === fromId ? null : { id, element: card }
      }
      const folder = element.closest('.folder-card[data-folder-id]')
      if (folder instanceof HTMLElement) {
        const id = `folder:${folder.dataset.folderId}`
        return id === fromId ? null : { id, element: folder }
      }
      return null
    }
    const apply = () => {
      frame = 0
      if (live !== null && pointer !== null) live.setAttribute('d', connectorPathToPoint(fromNode.position, { x: pointer.x, y: pointer.y }, fromSide))
      const next = pointer === null ? null : hoverTarget(pointer.clientX, pointer.clientY)
      if (next?.element !== target?.element) {
        target?.element?.classList.remove('connect-target')
        target = next
        target?.element?.classList.add('connect-target')
      }
    }
    const move = moveEvent => {
      const world = clientToWorld(moveEvent.clientX, moveEvent.clientY)
      pointer = world === null ? null : { x: world.x, y: world.y, clientX: moveEvent.clientX, clientY: moveEvent.clientY }
      if (frame === 0) frame = window.requestAnimationFrame(apply)
    }
    const stop = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', stop)
      document.removeEventListener('pointercancel', stop)
      if (frame !== 0) { window.cancelAnimationFrame(frame); frame = 0 }
      live?.remove()
      target?.element?.classList.remove('connect-target')
      suppressNextClick = true
      window.setTimeout(() => { suppressNextClick = false }, 300)
      if (target !== null && target.id !== fromId) connectCards(fromId, target.id, fromSide)
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', stop)
    document.addEventListener('pointercancel', stop)
  })
}

function clientToWorld(clientX, clientY) {
  const viewport = document.querySelector('.canvas-viewport')
  if (!(viewport instanceof HTMLElement)) return null
  const bounds = viewport.getBoundingClientRect()
  return { x: (clientX - bounds.left - state.canvasCamera.x) / state.zoom, y: (clientY - bounds.top - state.canvasCamera.y) / state.zoom }
}

function isFolderAncestor(ancestorId, folderId) {
  let current = state.folders.get(folderId)?.parentId ?? null
  const seen = new Set()
  while (current !== null && state.folders.has(current) && !seen.has(current)) {
    if (current === ancestorId) return true
    seen.add(current)
    current = state.folders.get(current).parentId
  }
  return false
}

// Drag a folder card; dropping it on another folder nests it inside.
function bindFolderDrag(handle) {
  handle.addEventListener('pointerdown', event => {
    const folderId = event.currentTarget.dataset.dragFolder
    const element = event.currentTarget.closest('.folder-card')
    const folder = folderId === undefined ? undefined : state.folders.get(folderId)
    if (folderId === undefined || !(element instanceof HTMLElement) || folder === undefined) return
    event.preventDefault()
    const grouped = lockGroupOf(`folder:${folderId}`) !== null
    let members
    if (grouped) {
      members = dragMembersFor(`folder:${folderId}`)
    } else if (state.selectedFolderIds.has(folderId) && (state.selectedCardIds.size + state.selectedFolderIds.size > 1)) {
      members = selectionDragMembers()
    } else {
      if (state.selectedCardIds.size > 0 || state.selectedFolderIds.size > 0) {
        state.selectedCardIds = new Set()
        state.selectedFolderIds = new Set()
        for (const el of app.querySelectorAll('.group-selected')) el.classList.remove('group-selected')
      }
      members = [{ kind: 'folder', id: folderId, ref: folder, element, initial: { ...folder.position } }]
    }
    members = members.filter(member => member.initial !== null && member.initial !== undefined && Number.isFinite(member.initial.x) && Number.isFinite(member.initial.y))
    if (members.length === 0) return
    state.dragging = true
    const origin = { x: event.clientX, y: event.clientY }
    let delta = { x: 0, y: 0 }
    let stopped = false
    let historyPushed = false
    let frame = 0
    let lastPointer = null
    let dropFolderId = null
    const folderUnder = (x, y) => {
      for (const el of app.querySelectorAll('.folder-card[data-folder-id]')) {
        if (!(el instanceof HTMLElement)) continue
        const r = el.getBoundingClientRect()
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
          const id = el.dataset.folderId
          if (id !== undefined && state.folders.has(id)) return id
        }
      }
      return null
    }
    const updateDropTarget = () => {
      let next = lastPointer === null ? null : folderUnder(lastPointer.x, lastPointer.y)
      if (next !== null && members.some(member => member.kind === 'folder' && member.id === next)) next = null
      if (next === dropFolderId) return
      if (dropFolderId !== null) {
        const prev = app.querySelector(`.folder-card[data-folder-id="${selectorValue(dropFolderId)}"]`)
        if (prev instanceof HTMLElement) prev.classList.remove('drop-target')
      }
      dropFolderId = next
      if (dropFolderId !== null) {
        const cur = app.querySelector(`.folder-card[data-folder-id="${selectorValue(dropFolderId)}"]`)
        if (cur instanceof HTMLElement) cur.classList.add('drop-target')
      }
    }
    const apply = () => {
      frame = 0
      for (const member of members) {
        member.ref.position = { x: member.initial.x + delta.x, y: member.initial.y + delta.y }
        if (member.kind === 'card') refreshCardConnectors(member.id)
        else refreshCardConnectors(`folder:${member.id}`)
        if (member.element instanceof HTMLElement) {
          member.element.style.left = `${member.initial.x + delta.x}px`
          member.element.style.top = `${member.initial.y + delta.y}px`
        }
      }
      updateDropTarget()
    }
    const move = moveEvent => {
      lastPointer = { x: moveEvent.clientX, y: moveEvent.clientY }
      if (!historyPushed && Math.hypot(moveEvent.clientX - origin.x, moveEvent.clientY - origin.y) > 3) { historyPushed = true; pushHistory() }
      delta = { x: (moveEvent.clientX - origin.x) / state.zoom, y: (moveEvent.clientY - origin.y) / state.zoom }
      if (frame === 0) frame = window.requestAnimationFrame(apply)
    }
    const stop = () => {
      if (stopped) return
      stopped = true
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', stop)
      document.removeEventListener('pointercancel', stop)
      if (frame !== 0) { window.cancelAnimationFrame(frame); frame = 0 }
      apply()
      updateDropTarget()
      const droppedFolderId = dropFolderId
      if (dropFolderId !== null) {
        const el = app.querySelector(`.folder-card[data-folder-id="${selectorValue(dropFolderId)}"]`)
        if (el instanceof HTMLElement) el.classList.remove('drop-target')
      }
      dropFolderId = null
      for (const member of members) {
        if (member.kind !== 'card') continue
        const aliases = typeof member.ref?.positionKey === 'string' ? [member.ref.positionKey] : []
        rememberCardPosition(member.id, { x: member.initial.x + delta.x, y: member.initial.y + delta.y }, aliases)
      }
      state.dragging = false
      if (droppedFolderId !== null && fileItems(members, droppedFolderId)) { render(); return }
      persistFolders()
      render()
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', stop)
    document.addEventListener('pointercancel', stop)
  })
}

// Drag the card inspector's left edge left/right to resize its width.
function bindInspectorResize(handle) {
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return
    const panel = handle.closest('.card-inspector')
    if (!(panel instanceof HTMLElement)) return
    const viewport = document.querySelector('.canvas-viewport')
    if (!(viewport instanceof HTMLElement)) return
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startWidth = panel.getBoundingClientRect().width
    const maxWidth = Math.max(320, viewport.getBoundingClientRect().width - 160)
    let width = startWidth
    let frame = 0
    const apply = () => {
      frame = 0
      state.inspectorWidth = Math.round(width)
      panel.style.width = `${state.inspectorWidth}px`
    }
    const move = moveEvent => {
      width = Math.max(280, Math.min(maxWidth, startWidth + (startX - moveEvent.clientX)))
      if (frame === 0) frame = window.requestAnimationFrame(apply)
    }
    const stop = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', stop)
      document.removeEventListener('pointercancel', stop)
      if (frame !== 0) { window.cancelAnimationFrame(frame); frame = 0 }
      apply()
      persistInspectorWidth()
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', stop)
    document.addEventListener('pointercancel', stop)
  })
}

function installDragging() {
  for (const handle of document.querySelectorAll('[data-drag-card]')) bindDragHandle(handle)
  for (const port of document.querySelectorAll('[data-connect-from]')) bindConnectPort(port)
  for (const handle of document.querySelectorAll('[data-drag-folder]')) bindFolderDrag(handle)
  for (const handle of document.querySelectorAll('[data-resize-inspector]')) bindInspectorResize(handle)
}

function canvasViewport(target) {
  return target instanceof Element ? target.closest('.canvas-viewport') : null
}

function zoomCanvas(viewport, nextZoom, clientX, clientY) {
  const zoom = Math.min(4, Math.max(.1, Math.round(nextZoom * 100) / 100))
  if (zoom === state.zoom) return
  const bounds = viewport.getBoundingClientRect()
  const localX = clientX - bounds.left
  const localY = clientY - bounds.top
  const worldX = (localX - state.canvasCamera.x) / state.zoom
  const worldY = (localY - state.canvasCamera.y) / state.zoom
  state.zoom = zoom
  state.canvasCamera = { x: localX - worldX * zoom, y: localY - worldY * zoom }
  const content = viewport.querySelector('.canvas-content')
  if (content instanceof HTMLElement) {
    // Drop the composited layer before zooming: a cached will-change raster
    // would be upscaled instead of re-rasterized, which was the original
    // zoom-blur bug. will-change re-applies via .is-panning on the next pan.
    content.style.willChange = 'auto'
    applyCanvasTransform()
    syncCanvasViewport()
    window.requestAnimationFrame(() => { content.style.willChange = '' })
  } else {
    applyCanvasTransform()
    syncCanvasViewport()
  }
  const label = document.querySelector('.canvas-controls span')
  if (label !== null) label.textContent = `${Math.round(state.zoom * 100)}%`
}

function zoomCanvasAtCenter(factor) {
  const viewport = document.querySelector('.canvas-viewport')
  if (!(viewport instanceof HTMLElement)) return
  const bounds = viewport.getBoundingClientRect()
  zoomCanvas(viewport, state.zoom * factor, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)
}

// Fit the camera+zoom so every item of the current page is visible.
function fitCanvasToItems() {
  const viewport = document.querySelector('.canvas-viewport')
  if (!(viewport instanceof HTMLElement)) return false
  const items = [...(state.canvasCards ?? []), ...(state.canvasFolders ?? []), ...(state.canvasContext ?? [])]
  const points = items.map(item => item.position).filter(position => position !== undefined && Number.isFinite(position.x) && Number.isFinite(position.y))
  if (points.length === 0) return false
  const minX = Math.min(...points.map(p => p.x))
  const minY = Math.min(...points.map(p => p.y))
  const maxX = Math.max(...points.map(p => p.x + CARD_WIDTH))
  const maxY = Math.max(...points.map(p => p.y + CARD_HEIGHT))
  const bounds = viewport.getBoundingClientRect()
  const padX = 40
  const padTop = state.viewFolderId !== null ? 56 : 40
  const padBottom = 40
  const width = Math.max(1, maxX - minX)
  const height = Math.max(1, maxY - minY)
  const availW = Math.max(40, bounds.width - padX * 2)
  const availH = Math.max(40, bounds.height - padTop - padBottom)
  const zoom = Math.min(4, Math.max(.1, Math.round(Math.min(availW / width, availH / height) * 100) / 100))
  state.zoom = zoom
  state.canvasCamera = {
    x: padX + availW / 2 - (minX + width / 2) * zoom,
    y: padTop + availH / 2 - (minY + height / 2) * zoom,
  }
  applyCanvasTransform()
  syncCanvasViewport()
  const label = document.querySelector('.canvas-controls span')
  if (label !== null) label.textContent = `${Math.round(state.zoom * 100)}%`
  return true
}

function focusActiveCard() {
  const viewport = document.querySelector('.canvas-viewport')
  if (!(viewport instanceof HTMLElement)) return
  const cards = state.canvasCards
  if (cards === undefined || cards.length === 0) return
  // Drafts win over the active conversation's latest turn; fall back to the
  // first card. Cards may be unmounted (outside the viewport), so the focus
  // target comes from the data model, never from DOM queries.
  const draft = state.draft === null ? undefined
    : state.draft.kind === 'new' ? { position: { x: 86, y: 82 } } : draftPlacement(cards)
  const activeCards = state.activeId === null || state.activeId === undefined ? [] : cards.filter(card => card.dshThreadId === state.activeId)
  const card = draft ?? activeCards.at(-1) ?? cards[0]
  const { x: left, y: top } = card.position
  const bounds = viewport.getBoundingClientRect()
  state.canvasCamera = {
    x: bounds.width / 2 - (left + CARD_WIDTH / 2) * state.zoom,
    y: bounds.height / 2 - (top + CARD_HEIGHT / 2) * state.zoom,
  }
  applyCanvasTransform()
  syncCanvasViewport()
}

let selectionFollowup = null
let selectionFollowupFrame = 0

function hideSelectionFollowup() {
  if (selectionFollowupFrame !== 0) {
    window.cancelAnimationFrame(selectionFollowupFrame)
    selectionFollowupFrame = 0
  }
  selectionFollowup = null
  const button = app.querySelector('.selection-followup')
  if (button instanceof HTMLButtonElement) button.hidden = true
}

function selectionFollowupTarget(range) {
  const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
  const end = range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement
  if (!(start instanceof Element) || !(end instanceof Element)) return null
  const answer = start.closest('.thread-answer')
  if (answer instanceof HTMLElement && answer.contains(end)) {
    const card = answer.closest('.thread-card[data-thread]:not(.draft-card)')
    if (card instanceof HTMLElement && card.dataset.thread !== undefined) return { threadId: card.dataset.thread }
  }
  const messageBody = start.closest('.message-assistant .message-body')
  const thread = currentThread()
  if (messageBody instanceof HTMLElement && messageBody.contains(end) && thread !== null) return { threadId: thread.id }
  return null
}

function updateSelectionFollowup() {
  selectionFollowupFrame = 0
  const button = app.querySelector('.selection-followup')
  const selection = window.getSelection()
  if (!(button instanceof HTMLButtonElement) || state.draft !== null || selection === null || selection.rangeCount !== 1 || selection.isCollapsed) return hideSelectionFollowup()
  const text = selection.toString().trim()
  const range = selection.getRangeAt(0)
  const target = text === '' || text.length > 4000 ? null : selectionFollowupTarget(range)
  const rect = range.getBoundingClientRect()
  if (target === null || rect.width === 0 || rect.height === 0) return hideSelectionFollowup()
  selectionFollowup = { ...target, text }
  button.dataset.thread = target.threadId
  button.style.left = `${Math.min(window.innerWidth - 12, Math.max(76, rect.right))}px`
  button.style.top = `${Math.min(window.innerHeight - 38, Math.max(8, rect.bottom + 8))}px`
  button.hidden = false
}

function queueSelectionFollowup() {
  if (selectionFollowupFrame !== 0) return
  selectionFollowupFrame = window.requestAnimationFrame(updateSelectionFollowup)
}

app.addEventListener('pointerdown', event => {
  if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.altKey || tabHeld) return
  const viewport = canvasViewport(event.target)
  if (!(viewport instanceof HTMLElement) || event.target instanceof Element && event.target.closest('.thread-card, button, textarea, select, .edge-hit')) return
  event.preventDefault()
  const origin = { x: event.clientX, y: event.clientY, camera: { ...state.canvasCamera } }
  let pendingCamera = null
  let frame = 0
  state.canvasGesture = true
  viewport.classList.add('is-panning')
  viewport.setPointerCapture(event.pointerId)
  const apply = () => {
    frame = 0
    if (pendingCamera === null) return
    state.canvasCamera = pendingCamera
    pendingCamera = null
    applyCanvasTransform()
    syncCanvasViewport()
  }
  const move = moveEvent => {
    pendingCamera = {
      x: origin.camera.x + moveEvent.clientX - origin.x,
      y: origin.camera.y + moveEvent.clientY - origin.y,
    }
    if (frame === 0) frame = window.requestAnimationFrame(apply)
  }
  const stop = () => {
    viewport.classList.remove('is-panning')
    document.removeEventListener('pointermove', move)
    document.removeEventListener('pointerup', stop)
    document.removeEventListener('pointercancel', stop)
    if (frame !== 0) { window.cancelAnimationFrame(frame); frame = 0 }
    apply()
    state.canvasGesture = false
    deferCanvasRefresh(120)
  }
  document.addEventListener('pointermove', move)
  document.addEventListener('pointerup', stop)
  document.addEventListener('pointercancel', stop)
})

// Right-button drag on the canvas draws a blue marquee; cards it touches get
// selected and can then be moved together by dragging any of them.
function cardsInRect(rect) {
  const ids = new Set()
  for (const card of state.canvasCards ?? []) {
    const { x, y } = card.position
    if (x + CARD_WIDTH < rect.x || x > rect.x + rect.width) continue
    if (y + CARD_HEIGHT < rect.y || y > rect.y + rect.height) continue
    ids.add(card.id)
  }
  return ids
}

function foldersInRect(rect) {
  const ids = new Set()
  for (const folder of state.canvasFolders ?? []) {
    const { x, y } = folder.position
    if (x + CARD_WIDTH < rect.x || x > rect.x + rect.width) continue
    if (y + CARD_HEIGHT < rect.y || y > rect.y + rect.height) continue
    ids.add(folder.id)
  }
  return ids
}

const STACK_STEP_X = 26
const STACK_STEP_Y = 22

// Ctrl + marquee: pile the selected cards into a staggered stack (playing-card
// cascade) anchored on the top-left card's spot. The selection stays active, so
// dragging any card moves the whole stack together.
function stackSelectedCards(ids) {
  const cards = (state.canvasCards ?? []).filter(card => ids.has(card.id))
  if (cards.length < 2) return
  const ordered = [...cards].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
  const base = ordered[0].position
  pushHistory()
  for (let index = 0; index < ordered.length; index++) {
    const card = ordered[index]
    const position = { x: Math.round(base.x + index * STACK_STEP_X), y: Math.round(base.y + index * STACK_STEP_Y) }
    state.cardPositions.set(card.id, position)
    if (typeof card.positionKey === 'string') state.cardPositions.set(card.positionKey, position)
  }
  persistCardPositions()
}

app.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !(event.shiftKey || event.ctrlKey || event.altKey || tabHeld)) return
  const shouldFolder = tabHeld
  const shouldStack = !tabHeld && !event.altKey && event.ctrlKey && !event.shiftKey
  const shouldLock = event.altKey && !tabHeld && !event.ctrlKey && !event.shiftKey
  const viewport = canvasViewport(event.target)
  if (!(viewport instanceof HTMLElement)) return
  if (event.target instanceof Element && event.target.closest('button, input, textarea, select, a')) return
  event.preventDefault()
  event.stopPropagation()
  const start = clientToWorld(event.clientX, event.clientY)
  if (start === null) return
  const content = document.querySelector('.canvas-content')
  const marquee = document.createElement('div')
  marquee.className = 'marquee'
  if (content instanceof HTMLElement) content.appendChild(marquee)
  const base = new Set()
  const origin = { x: event.clientX, y: event.clientY }
  let current = start
  let frame = 0
  const apply = () => {
    frame = 0
    const x = Math.min(start.x, current.x)
    const y = Math.min(start.y, current.y)
    const width = Math.abs(current.x - start.x)
    const height = Math.abs(current.y - start.y)
    marquee.style.left = `${x}px`
    marquee.style.top = `${y}px`
    marquee.style.width = `${width}px`
    marquee.style.height = `${height}px`
    const ids = new Set([...base, ...cardsInRect({ x, y, width, height })])
    const folderIds = foldersInRect({ x, y, width, height })
    state.selectedCardIds = ids
    state.selectedFolderIds = folderIds
    for (const element of app.querySelectorAll('.thread-card[data-card-id]')) {
      if (!(element instanceof HTMLElement)) continue
      element.classList.toggle('group-selected', element.dataset.cardId !== undefined && ids.has(element.dataset.cardId))
    }
    for (const element of app.querySelectorAll('.folder-card[data-folder-id]')) {
      if (!(element instanceof HTMLElement)) continue
      element.classList.toggle('group-selected', element.dataset.folderId !== undefined && folderIds.has(element.dataset.folderId))
    }
  }
  const move = moveEvent => {
    const world = clientToWorld(moveEvent.clientX, moveEvent.clientY)
    if (world !== null) current = world
    if (frame === 0) frame = window.requestAnimationFrame(apply)
  }
  const stop = () => {
    document.removeEventListener('pointermove', move)
    document.removeEventListener('pointerup', stop)
    document.removeEventListener('pointercancel', stop)
    if (frame !== 0) { window.cancelAnimationFrame(frame); frame = 0 }
    apply()
    marquee.remove()
    if (shouldStack) { stackSelectedCards(state.selectedCardIds); render() }
    else if (shouldFolder) createFolderFromSelection(state.selectedCardIds, state.selectedFolderIds)
    else if (shouldLock) lockSelection(state.selectedCardIds, state.selectedFolderIds)
    // A marquee drag also emits a click on release; without this the "click
    // empty canvas clears selection" rule would wipe the fresh selection.
    suppressNextClick = true
    window.setTimeout(() => { suppressNextClick = false }, 300)
    deferCanvasRefresh(120)
  }
  document.addEventListener('pointermove', move)
  document.addEventListener('pointerup', stop)
  document.addEventListener('pointercancel', stop)
})

app.addEventListener('wheel', event => {
  const viewport = canvasViewport(event.target)
  if (!(viewport instanceof HTMLElement)) return
  const card = event.target instanceof Element ? event.target.closest('.thread-card') : null
  if (card instanceof HTMLElement) {
    // Over a card the wheel scrolls that card's own answer with the browser's
    // native wheel (OS-smooth, never a page jump per notch); the answer's
    // overscroll-behavior: contain stops the scroll chaining into the canvas.
    const answer = card.querySelector('.thread-answer')
    if (answer instanceof HTMLElement && answer.scrollHeight > answer.clientHeight) {
      deferCanvasRefresh()
      return
    }
    // A card with no scrollable answer swallows the wheel instead of zooming.
    event.preventDefault()
    deferCanvasRefresh()
    return
  }
  event.preventDefault()
  zoomCanvas(viewport, state.zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12), event.clientX, event.clientY)
}, { passive: false })

// Track pointer-down so the card click handler can tell a plain click from a
// text-selection or drag gesture; acting on the latter would re-render and
// wipe the user's selection.
let pointerDownPosition = null
app.addEventListener('pointerdown', event => { pointerDownPosition = { x: event.clientX, y: event.clientY } })
app.addEventListener('pointerdown', event => {
  const button = event.target instanceof Element ? event.target.closest('.selection-followup') : null
  if (button instanceof HTMLButtonElement) event.preventDefault()
  else hideSelectionFollowup()
})
app.addEventListener('pointerup', queueSelectionFollowup)
app.addEventListener('scroll', hideSelectionFollowup, true)
document.addEventListener('selectionchange', queueSelectionFollowup)
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || state.mode !== 'canvas' || state.inspectorCardId === null) return
  event.preventDefault()
  closeCardInspector({ animate: false })
})

// Right-click a button to record a keyboard shortcut for it.
app.addEventListener('contextmenu', event => {
  const button = event.target instanceof Element ? event.target.closest('[data-action]') : null
  if (button instanceof HTMLElement) {
    event.preventDefault()
    const signature = buttonSignature(button)
    const existing = Object.keys(shortcuts).find(key => shortcuts[key] === signature)
    shortcutCapture = { signature, label: button.title || button.getAttribute('aria-label') || button.dataset.action || '按钮' }
    shortcutHint(`按下要绑定的按键${existing === undefined ? '' : `（当前：${existing}）`}，Esc 取消，Delete 清除`)
    return
  }
})

// Capture phase: while recording, the next key becomes the shortcut.
document.addEventListener('keydown', event => {
  if (shortcutCapture === null) return
  event.preventDefault()
  event.stopPropagation()
  if (event.key === 'Escape') { shortcutCapture = null; hideShortcutHint(); return }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    const label = shortcutCapture.label
    clearShortcut(shortcutCapture.signature)
    shortcutCapture = null
    shortcutHint(`已清除 ${label} 的快捷键`, true)
    return
  }
  const combo = shortcutKeyFromEvent(event)
  if (combo === null) return
  const capture = shortcutCapture
  shortcutCapture = null
  bindShortcut(combo, capture.signature)
  shortcutHint(`已绑定：${combo} → ${capture.label}`, true)
}, true)

// Fire undo/redo and user shortcuts.
document.addEventListener('keydown', event => {
  if (shortcutCapture !== null) return
  const target = event.target
  if (target instanceof Element && (target.matches('input, textarea, select') || target.isContentEditable)) return
  const combo = shortcutKeyFromEvent(event)
  if (combo === null) return
  if (combo === 'ctrl+z') { event.preventDefault(); undoCanvas(); return }
  if (combo === 'ctrl+y' || combo === 'ctrl+shift+z') { event.preventDefault(); redoCanvas(); return }
  const signature = shortcuts[combo]
  if (signature === undefined) return
  event.preventDefault()
  triggerShortcut(signature)
})

app.addEventListener('click', async event => {
  if (suppressNextClick) { suppressNextClick = false; return }
  // Clicking a connector removes it (auto edges ask first). Ignore the click
  // when it was really a drag along the edge.
  const edge = event.target instanceof Element ? event.target.closest('.connectors .edge-group[data-edges]') : null
  if (edge instanceof Element) {
    event.preventDefault()
    if (pointerDownPosition === null || Math.hypot(event.clientX - pointerDownPosition.x, event.clientY - pointerDownPosition.y) <= 4) {
      let keys = []
      try { keys = JSON.parse(edge.getAttribute('data-edges') ?? '[]') } catch { keys = [] }
      if (Array.isArray(keys) && keys.length > 0) removeEdgeKeys(keys)
    }
    return
  }
  const button = event.target.closest('[data-action]')
  if (!(button instanceof HTMLElement)) {
    // Clicking anywhere on a folder card (except its buttons) opens it.
    const folderCard = event.target instanceof Element ? event.target.closest('.folder-card[data-folder-id]') : null
    if (folderCard instanceof HTMLElement && !(event.target instanceof Element && event.target.closest('button'))) {
      event.preventDefault()
      state.viewFolderId = folderCard.dataset.folderId ?? null
      state.selectedCardIds = new Set()
      state.selectedFolderIds = new Set()
      state.canvasViewInitialized = false
      resetCanvasCamera()
      state.canvasNeedsFit = true
      render()
      return
    }
    const card = event.target instanceof Element ? event.target.closest('.thread-card[data-thread]:not(.draft-card)') : null
    if (!(card instanceof HTMLElement) || event.target instanceof Element && event.target.closest('.node-handle, .edge-port, textarea, select, form')) {
      // Clicking empty canvas clears the marquee selection.
      if ((state.selectedCardIds.size > 0 || state.selectedFolderIds.size > 0) && event.target instanceof Element && event.target.closest('.canvas-viewport')) {
        state.selectedCardIds = new Set()
        state.selectedFolderIds = new Set()
        render()
      }
      return
    }
    // A double-click selects a word and a drag selects a range; neither is a
    // select-click, so leave the selection intact instead of re-rendering.
    if (event.detail > 1) return
    if (pointerDownPosition !== null
      && Math.hypot(event.clientX - pointerDownPosition.x, event.clientY - pointerDownPosition.y) > 4) return
    const thread = state.workspace?.threads.find(item => item.id === card.dataset.thread)
    if (thread === undefined) return
    const cardId = card.dataset.cardId
    if (cardId === undefined) return
    state.activeId = thread.id
    state.selectedCardId = cardId
    openCardInspector(cardId)
    state.error = ''
    render()
    void loadThreadHistory(thread)
    // Bidirectional current-session sync: switch DSH's current session
    // without closing the map; the client confirms via synapse:current-session.
    if (thread.dshSessionId !== null) {
      if (thread.dshSessionId !== state.currentDsh?.id) state.mapCardSessionSwitches.add(thread.dshSessionId)
      post('synapse:activate-session', { sessionId: thread.dshSessionId })
    }
    return
  }
  const thread = state.workspace?.threads.find(item => item.id === button.dataset.thread)
  try {
    if (button.dataset.action === 'follow-selection') {
      const followup = selectionFollowup
      hideSelectionFollowup()
      if (followup !== null && thread !== undefined && thread.id === followup.threadId && state.draft === null) openContinue(thread, undefined, followup.text)
      return
    }
    if (button.dataset.action === 'insert-quick-phrase' && button.dataset.quickPhrase !== undefined) insertQuickPhrase(button.dataset.quickPhrase)
    if (button.dataset.action === 'open-quick-phrase-editor') { state.quickPhraseEditorOpen = true; render() }
    if (button.dataset.action === 'close-quick-phrase-editor') { state.quickPhraseEditorOpen = false; render() }
    if (button.dataset.action === 'add-quick-phrase') {
      const editor = button.closest('.draft-quick-phrase-add')
      const input = editor?.querySelector('input')
      if (input instanceof HTMLInputElement && addQuickPhrase(input.value)) {
        render()
        window.setTimeout(() => document.querySelector('.draft-quick-phrase-add input')?.focus(), 0)
      }
    }
    if (button.dataset.action === 'remove-quick-phrase') {
      const index = Number(button.dataset.quickPhraseIndex)
      if (Number.isInteger(index) && index >= 0 && index < state.quickPhrases.length) {
        pushHistory()
        state.quickPhrases.splice(index, 1)
        persistQuickPhrases()
        render()
      }
    }
    if (button.dataset.action === 'close') post('synapse:close')
    if (button.dataset.action === 'close-card-inspector') { closeCardInspector(); return }
    if (button.dataset.action === 'toggle-sidebar') { state.sidebarCollapsed = !state.sidebarCollapsed; render() }
    if (button.dataset.action === 'create-session') openNewSession()
    if (button.dataset.action === 'open-current' && state.currentDsh !== null) post('synapse:open-session', { sessionId: state.currentDsh.id })
    if (button.dataset.action === 'select-thread' && thread !== undefined) {
      state.mapCardSessionSwitches.clear()
      state.activeId = thread.id
      state.selectedCardId = null
      state.inspectorCardId = null
      state.inspectorOpening = false
      state.error = ''
      if (state.workspace !== null) revealConversationThread(conversationCards(state.workspace.threads), thread.id)
      render()
      void loadThreadHistory(thread)
      // Bidirectional current-session sync: switch DSH's current session
      // without closing the map; the client confirms via synapse:current-session.
      if (thread.dshSessionId !== null) post('synapse:activate-session', { sessionId: thread.dshSessionId })
    }
    if (button.dataset.action === 'show-thread' && thread !== undefined) { state.activeId = thread.id; state.mode = 'thread'; state.detailTargetCardId = button.dataset.card ?? null; render(); void loadThreadHistory(thread) }
    if (button.dataset.action === 'show-canvas') { state.mode = 'canvas'; render() }
    if (button.dataset.action === 'toggle-card-children' && button.dataset.card !== undefined) {
      const cardId = button.dataset.card
      const collapsing = !state.collapsedCardIds.has(cardId)
      if (collapsing && state.workspace !== null) {
        const allCards = conversationCards(state.workspace.threads)
        const nextCollapsed = new Set(state.collapsedCardIds).add(cardId)
        const visibleCards = conversationGraphView(allCards, nextCollapsed).cards
        const visibleIds = new Set(visibleCards.map(card => card.id))
        const draftParentId = draftPlacement(allCards)?.parent.id
        if (draftParentId !== undefined && !visibleIds.has(draftParentId)) return setError('请先完成或取消正在编辑的追问或分支')
        if (state.activeId !== null && !visibleCards.some(card => card.dshThreadId === state.activeId)) return setError('当前会话位于这个后续分支中，请先切换会话')
      }
      pushHistory()
      collapsing ? state.collapsedCardIds.add(cardId) : state.collapsedCardIds.delete(cardId)
      persistCollapsedCards()
      render()
      window.setTimeout(() => document.querySelector(`[data-action="toggle-card-children"][data-card="${selectorValue(cardId)}"]`)?.focus(), 0)
    }
    if (button.dataset.action === 'open-continue' && thread !== undefined) openContinue(thread, button.dataset.card)
    if (button.dataset.action === 'open-branch' && thread !== undefined) {
      const requestedSeq = Number(button.dataset.seq)
      if (button.dataset.card !== undefined && !Number.isInteger(requestedSeq)) return setError('请等待这张卡片的最终回答后再创建分支')
      const fallbackSeq = latestMessage(thread, 'assistant')?.sourceSeq
      openBranch(thread, Number.isInteger(requestedSeq) ? requestedSeq : fallbackSeq, button.dataset.card)
    }
    if (button.dataset.action === 'cancel-draft') { state.draft = null; state.quickPhraseEditorOpen = false; render() }
    if (button.dataset.action === 'remove-attachment') {
      const index = Number(button.dataset.index)
      if (state.draft !== null && Number.isInteger(index) && Array.isArray(state.draft.attachments)) { state.draft.attachments.splice(index, 1); render() }
      return
    }
    if (button.dataset.action === 'toggle-message' && button.dataset.message !== undefined) { state.expandedMessageIds.has(button.dataset.message) ? state.expandedMessageIds.delete(button.dataset.message) : state.expandedMessageIds.add(button.dataset.message); renderPreservingDetailScroll() }
    if (button.dataset.action === 'open-dsh' && thread?.dshSessionId !== null) post('synapse:open-session', { sessionId: thread.dshSessionId, seq: Number.isInteger(Number(button.dataset.seq)) ? Number(button.dataset.seq) : undefined })
    if (button.dataset.action === 'archive-thread' && thread !== undefined) await archiveThread(thread)
    if (button.dataset.action === 'hide-card' && button.dataset.card !== undefined) hideCard(button.dataset.card)
    if (button.dataset.action === 'restore-card' && button.dataset.card !== undefined) restoreCard(button.dataset.card)
    if (button.dataset.action === 'toggle-hidden') { state.hiddenPanelOpen = !state.hiddenPanelOpen; render(); return }
    if (button.dataset.action === 'close-hidden') { state.hiddenPanelOpen = false; render(); return }
    if (button.dataset.action === 'zoom-in') zoomCanvasAtCenter(1.15)
    if (button.dataset.action === 'zoom-out') zoomCanvasAtCenter(1 / 1.15)
    if (button.dataset.action === 'undo') { undoCanvas(); return }
    if (button.dataset.action === 'redo') { redoCanvas(); return }
    if (button.dataset.action === 'focus-active') focusActiveCard()
    if (button.dataset.action === 'dismiss-error') { state.error = ''; render() }
    if (button.dataset.action === 'export-canvas') { await exportCanvas(); return }
    if (button.dataset.action === 'open-folder' && button.dataset.folder !== undefined) {
      state.viewFolderId = button.dataset.folder
      state.selectedCardIds = new Set()
      state.selectedFolderIds = new Set()
      state.canvasViewInitialized = false
      resetCanvasCamera()
      state.canvasNeedsFit = true
      render()
      return
    }
    if (button.dataset.action === 'folder-back') {
      const current = state.folders.get(state.viewFolderId)
      state.viewFolderId = current !== undefined && current.parentId !== null ? current.parentId : null
      state.selectedCardIds = new Set()
      state.selectedFolderIds = new Set()
      state.canvasViewInitialized = false
      resetCanvasCamera()
      state.canvasNeedsFit = true
      render()
      return
    }
    if (button.dataset.action === 'rename-folder' && button.dataset.folder !== undefined) {
      const folder = state.folders.get(button.dataset.folder)
      if (folder !== undefined) {
        const entered = window.prompt('重命名文件夹', folder.name)
        if (entered !== null && entered.trim() !== '') { pushHistory(); folder.name = entered.trim().slice(0, 40); persistFolders(); render() }
      }
      return
    }
    if (button.dataset.action === 'dissolve-folder' && button.dataset.folder !== undefined) { dissolveFolder(button.dataset.folder); return }
    if (button.dataset.action === 'move-card-out' && button.dataset.card !== undefined) { moveCardOut(button.dataset.card); return }
  } catch (error) { setError(error) }
})

app.addEventListener('change', event => {
  const fileInput = event.target instanceof Element ? event.target.closest('[data-draft-file]') : null
  if (fileInput instanceof HTMLInputElement) {
    if (state.draft !== null && fileInput.files !== null) {
      const attachments = Array.isArray(state.draft.attachments) ? state.draft.attachments : (state.draft.attachments = [])
      for (const file of fileInput.files) attachments.push(file)
      render()
      window.setTimeout(() => document.querySelector('[data-draft] textarea')?.focus(), 0)
    }
    return
  }
  const quickPhrase = event.target instanceof Element ? event.target.closest('[data-quick-phrase-index]') : null
  if (quickPhrase instanceof HTMLInputElement) {
    updateQuickPhrase(Number(quickPhrase.dataset.quickPhraseIndex), quickPhrase.value)
    return
  }
  const select = event.target.closest('[data-action="select-workspace"]')
  if (!(select instanceof HTMLSelectElement)) return
  const choice = workspaceChoices().find(item => item.id === select.value)
  state.inspectorCardId = null
  state.inspectorOpening = false
  if (choice?.source === 'dsh') {
    // Map → native sync: switching workspaces moves DSH's current session to
    // the workspace's most recently updated session, keeping both sides in step.
    void openDshWorkspace(choice.id).then(opened => {
      if (!opened) return
      const threads = state.workspace?.threads ?? []
      const latest = threads
        .filter(thread => thread.dshSessionId !== null)
        .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))[0]
      const sessionId = latest?.dshSessionId ?? choice.sessionIds[0]
      if (sessionId !== undefined) post('synapse:activate-session', { sessionId })
    }).catch(setError)
  } else if (choice !== undefined) { state.selectedDshWorkspaceId = null; void openWorkspace(choice.id).catch(setError) }
})
app.addEventListener('input', event => { const input = event.target; if (input instanceof HTMLTextAreaElement && input.closest('[data-draft]') && state.draft !== null) state.draft.text = input.value })
app.addEventListener('submit', event => {
  const form = event.target
  if (!(form instanceof HTMLFormElement)) return
  if (form.matches('[data-draft]')) { event.preventDefault(); void submitDraft(); return }
  const thread = state.workspace?.threads.find(item => item.id === form.dataset.compose)
  const input = form.querySelector('textarea')
  if (thread === undefined || !(input instanceof HTMLTextAreaElement) || input.value.trim() === '') return
  event.preventDefault()
  const text = input.value.trim()
  input.value = ''
  void sendMessage(thread, text).catch(setError)
})

window.addEventListener('message', event => {
  if (event.origin !== window.location.origin || event.data?.source !== 'dsh-synapse') return
  const data = event.data
  if (data.type === 'synapse:map-opened') {
    // Do NOT reset the camera here: toggling dialog<->map for the same
    // session must keep the user's viewport. A fresh canvas (canvasView
    // not initialized) still centers via renderCanvas; a real session switch
    // re-centers in the current-session handler below.
    state.mode = 'canvas'
    if (!state.mapOpenedOnce) { state.mapOpenedOnce = true; state.canvasNeedsFit = true }
    render()
    window.requestAnimationFrame(() => post('synapse:map-ready'))
  }
  if (data.type === 'synapse:theme') {
    document.documentElement.dataset.theme = data.dark === true ? 'dark' : 'light'
  }
  if (data.type === 'synapse:workspaces') {
    state.dshWorkspaces = Array.isArray(data.workspaces) ? data.workspaces.filter(workspace => typeof workspace?.id === 'string' && typeof workspace.title === 'string' && Array.isArray(workspace.sessionIds)) : []
    const current = currentDshWorkspace()
    if (current !== undefined && current.id !== state.selectedDshWorkspaceId) void openDshWorkspace(current.id).catch(setError)
    else if (state.selectedDshWorkspaceId !== null) void openDshWorkspace(state.selectedDshWorkspaceId).catch(setError)
    else if (canReplaceView()) render()
  }
  if (data.type === 'synapse:current-session') {
    const previousId = state.currentDsh?.id
    state.currentDsh = data.session
    const preserveCanvasCamera = previousId !== data.session?.id && state.mapCardSessionSwitches.delete(data.session?.id)
    const thread = currentDshThread()
    if (thread !== undefined) {
      const preserveSelectedCard = state.activeId === thread.id
      state.activeId = thread.id
      if (!preserveSelectedCard) {
        state.selectedCardId = null
        state.inspectorCardId = null
        state.inspectorOpening = false
      }
      if (state.workspace !== null) revealConversationThread(conversationCards(state.workspace.threads), thread.id)
    }
    if (previousId !== data.session?.id) {
      // A real session switch: re-center on the new session's latest turn,
      // whether it lives in the same workspace (openCurrentWorkspace returns
      // false) or a different one (it resets the camera itself).
      void openCurrentWorkspace({ preserveCanvasCamera }).then(opened => {
        if (!opened && canReplaceView()) {
          render()
          if (!preserveCanvasCamera) focusActiveCard()
        }
      }).catch(setError)
    }
    else if (canReplaceView()) render()
  }
  if (data.type === 'synapse:live-reply' && typeof data.sessionId === 'string') {
    const thread = state.workspace?.threads.find(item => item.dshSessionId === data.sessionId)
    if (thread !== undefined) {
      if (data.running === true) {
        state.liveReplies.set(data.sessionId, { running: true, text: typeof data.text === 'string' ? data.text : '' })
        // Streaming: patch the live card's answer in place instead of
        // rebuilding the whole canvas on every chunk; a full render reconciles
        // at stream end. The detail view is single-thread, so keep its cheap
        // throttled full render.
        if (state.mode === 'canvas') scheduleLiveCardUpdate(data.sessionId)
        else if (canReplaceView()) scheduleLiveRender()
      } else {
        state.liveReplies.delete(data.sessionId)
        if (canReplaceView() || state.pendingReplies.has(data.sessionId)) renderPreservingDetailScroll()
      }
    }
  }
  if (data.type === 'synapse:forked-session' || data.type === 'synapse:created-session' || data.type === 'synapse:message-sent') settleRpc(data.requestId, data.session ?? data)
  if (data.type === 'synapse:bridge-error') { settleRpc(data.requestId, undefined, new Error(data.message)); if (data.requestId === undefined) setError(data.message) }
})

post('synapse:request-current')
refreshSummaries().catch(setError)
let polling = false
let liveRenderTimer = 0
let liveCardFrame = 0
let liveCardSessionId = null
function scheduleLiveCardUpdate(sessionId) {
  // Coalesce streaming chunks to one DOM patch per animation frame.
  liveCardSessionId = sessionId
  if (liveCardFrame !== 0) return
  liveCardFrame = window.requestAnimationFrame(() => {
    liveCardFrame = 0
    if (liveCardSessionId === null) return
    const id = liveCardSessionId
    liveCardSessionId = null
    applyLiveReplyToCard(id)
  })
}
function applyLiveReplyToCard(sessionId) {
  if (state.mode !== 'canvas') return
  // Never patch cards mid-gesture: the reflow would compete with the drag or
  // pan frame; the next live-reply chunk re-applies after the gesture ends.
  if (state.dragging || state.canvasGesture) return
  const thread = state.workspace?.threads.find(item => item.dshSessionId === sessionId)
  if (thread === undefined) return
  const live = state.liveReplies.get(sessionId)
  if (live?.running !== true) return
  const cards = app.querySelectorAll(`.thread-card[data-thread="${CSS.escape(thread.id)}"]`)
  const card = cards[cards.length - 1]
  if (!(card instanceof HTMLElement)) return
  const answer = card.querySelector('.thread-answer')
  if (!(answer instanceof HTMLElement)) return
  const text = live.text
  answer.innerHTML = text.trim() === ''
    ? '<p class="thread-answer-pending">正在回复</p>'
    : `${renderMarkdown(text)}<p class="thread-answer-pending">正在回复</p>`
}
function scheduleLiveRender() {
  if (liveRenderTimer !== 0 || !canReplaceView()) return
  liveRenderTimer = window.setTimeout(() => {
    liveRenderTimer = 0
    if (canReplaceView()) renderPreservingDetailScroll()
  }, 120)
}
async function pollProjection() {
  if (polling || document.hidden || !canReplaceView()) return
  polling = true
  try {
    await refreshProjection()
  } finally { polling = false }
}
window.setInterval(() => { void pollProjection() }, 1_000)
