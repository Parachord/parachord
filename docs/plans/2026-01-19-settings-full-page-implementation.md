# Settings Full Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert the settings modal into a full-page view with vertical tabs and Tomahawk-style card aesthetics.

**Architecture:** Replace the modal overlay with a new `'settings'` view in the existing navigation system. The settings page has its own vertical tab navigation. Resolver cards are redesigned to be clean colored squares with centered icons.

**Tech Stack:** React (createElement), Tailwind CSS (CDN), existing state management patterns

---

## Task 1: Update State Management

**Files:**
- Modify: `app.js:697-703`

**Step 1: Update settingsTab state to include new tabs**

Change line 703 from:
```javascript
const [settingsTab, setSettingsTab] = useState('installed'); // 'installed' | 'marketplace'
```

To:
```javascript
const [settingsTab, setSettingsTab] = useState('installed'); // 'installed' | 'marketplace' | 'general' | 'about'
```

**Step 2: Remove showSettings state**

Delete line 697:
```javascript
const [showSettings, setShowSettings] = useState(false);
```

**Step 3: Verify changes compile**

Run: Open the app and ensure no errors in console.

**Step 4: Commit**

```bash
git add app.js
git commit -m "refactor: update settings state for full-page view"
```

---

## Task 2: Update Settings Button to Navigate to Settings View

**Files:**
- Modify: `app.js:4638-4650` (sidebar settings button)

**Step 1: Change settings button onClick**

Change line 4641 from:
```javascript
onClick: () => setShowSettings(!showSettings),
```

To:
```javascript
onClick: () => navigateTo('settings'),
```

**Step 2: Update button active state styling**

Change lines 4640-4642 from:
```javascript
React.createElement('button', {
  onClick: () => setShowSettings(!showSettings),
  className: 'w-full flex items-center gap-3 px-3 py-2 rounded text-sm text-gray-600 hover:bg-gray-100 transition-colors'
},
```

To:
```javascript
React.createElement('button', {
  onClick: () => navigateTo('settings'),
  className: `w-full flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors ${
    activeView === 'settings' ? 'bg-gray-200 text-gray-900' : 'text-gray-600 hover:bg-gray-100'
  }`
},
```

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat: connect settings button to navigation system"
```

---

## Task 3: Remove the Settings Modal

**Files:**
- Modify: `app.js:5885-6257` (settings modal)

**Step 1: Delete the entire settings modal block**

Remove the entire block from line 5885 (`// Settings Modal`) through line 6257 (closing of modal).

This is approximately 372 lines starting with:
```javascript
// Settings Modal
showSettings && React.createElement('div', {
  className: 'fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50'
},
```

**Step 2: Verify app still runs**

Run: Open the app, ensure no render errors.

**Step 3: Commit**

```bash
git add app.js
git commit -m "refactor: remove settings modal in preparation for full-page view"
```

---

## Task 4: Create Settings Page Component

**Files:**
- Modify: `app.js` (add after line ~5617, near other view conditionals)

**Step 1: Add settings view conditional rendering**

Find the section around lines 5611-5620 where other views are conditionally rendered:
```javascript
activeView === 'friends' && React.createElement('div', {
activeView === 'discover' && React.createElement('div', {
activeView === 'new-releases' && React.createElement('div', {
```

Add after `activeView === 'new-releases'` block, the settings page structure:

```javascript
activeView === 'settings' && React.createElement('div', {
  className: 'flex h-full'
},
  // Settings vertical tabs (left side)
  React.createElement('div', {
    className: 'w-48 border-r border-gray-200 py-6 flex-shrink-0'
  },
    React.createElement('nav', { className: 'space-y-1 px-3' },
      // Installed Resolvers tab
      React.createElement('button', {
        onClick: () => setSettingsTab('installed'),
        className: `w-full text-left px-4 py-3 text-sm transition-colors ${
          settingsTab === 'installed'
            ? 'text-gray-900 font-medium border-l-2 border-purple-600 bg-gray-50'
            : 'text-gray-600 hover:bg-gray-50 border-l-2 border-transparent'
        }`
      }, 'Installed Resolvers'),
      // Marketplace tab
      React.createElement('button', {
        onClick: () => setSettingsTab('marketplace'),
        className: `w-full text-left px-4 py-3 text-sm transition-colors ${
          settingsTab === 'marketplace'
            ? 'text-gray-900 font-medium border-l-2 border-purple-600 bg-gray-50'
            : 'text-gray-600 hover:bg-gray-50 border-l-2 border-transparent'
        }`
      }, 'Marketplace'),
      // General tab (placeholder)
      React.createElement('button', {
        onClick: () => setSettingsTab('general'),
        className: `w-full text-left px-4 py-3 text-sm transition-colors ${
          settingsTab === 'general'
            ? 'text-gray-900 font-medium border-l-2 border-purple-600 bg-gray-50'
            : 'text-gray-600 hover:bg-gray-50 border-l-2 border-transparent'
        }`
      }, 'General'),
      // About tab (placeholder)
      React.createElement('button', {
        onClick: () => setSettingsTab('about'),
        className: `w-full text-left px-4 py-3 text-sm transition-colors ${
          settingsTab === 'about'
            ? 'text-gray-900 font-medium border-l-2 border-purple-600 bg-gray-50'
            : 'text-gray-600 hover:bg-gray-50 border-l-2 border-transparent'
        }`
      }, 'About')
    )
  ),
  // Settings content area (right side)
  React.createElement('div', {
    className: 'flex-1 overflow-y-auto p-8'
  },
    // Content will be added in subsequent tasks
    React.createElement('div', { className: 'text-gray-500' }, 'Settings content placeholder')
  )
),
```

**Step 2: Verify settings page renders**

Run: Click Settings in sidebar, verify the tabbed layout appears.

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat: add settings full-page layout with vertical tabs"
```

---

## Task 5: Create Tomahawk-Style Resolver Card Component

**Files:**
- Modify: `app.js` (add after TrackRow component, around line 200)

**Step 1: Add ResolverCard component**

Add this component definition after the TrackRow component (around line 200):

```javascript
// ResolverCard component - Tomahawk-style colored card with centered icon
const ResolverCard = React.memo(({
  resolver,
  isActive,
  isInstalled,
  hasUpdate,
  isInstalling,
  onToggle,
  onInstall,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onContextMenu,
  showToggle = false,
  showInstall = false,
  draggable = false
}) => {
  return React.createElement('div', {
    className: 'flex flex-col items-center',
    draggable: draggable,
    onDragStart: draggable ? onDragStart : undefined,
    onDragOver: draggable ? onDragOver : undefined,
    onDrop: draggable ? onDrop : undefined,
    onDragEnd: draggable ? onDragEnd : undefined,
    onContextMenu: onContextMenu
  },
    // Card with colored background
    React.createElement('div', {
      className: `relative w-32 h-32 rounded-lg flex items-center justify-center cursor-pointer transition-all hover:scale-105 hover:shadow-lg ${
        !isActive && showToggle ? 'opacity-50 grayscale' : ''
      }`,
      style: { backgroundColor: resolver.color || '#6B7280' },
      onClick: showToggle ? onToggle : (showInstall ? onInstall : undefined)
    },
      // Centered icon
      React.createElement('span', {
        className: 'text-5xl text-white drop-shadow-md'
      }, resolver.icon),
      // Status overlay for installed/update
      isInstalled && !showToggle && React.createElement('div', {
        className: `absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center text-xs ${
          hasUpdate ? 'bg-orange-500 text-white' : 'bg-white text-green-600'
        }`
      }, hasUpdate ? '↑' : '✓'),
      // Installing spinner
      isInstalling && React.createElement('div', {
        className: 'absolute inset-0 bg-black/40 rounded-lg flex items-center justify-center'
      },
        React.createElement('span', { className: 'text-white text-2xl animate-spin' }, '⏳')
      )
    ),
    // Name below card
    React.createElement('span', {
      className: 'mt-2 text-sm text-gray-900 font-medium text-center truncate w-32'
    }, resolver.name),
    // Subtitle (author or status)
    showInstall && React.createElement('span', {
      className: 'text-xs text-gray-500 truncate w-32 text-center'
    }, resolver.author)
  );
});
```

**Step 2: Verify component exists**

Run: Check console for any syntax errors.

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat: add ResolverCard component with Tomahawk styling"
```

---

## Task 6: Implement Installed Resolvers Tab Content

**Files:**
- Modify: `app.js` (settings content area from Task 4)

**Step 1: Replace placeholder with Installed Resolvers content**

Find the settings content placeholder we added in Task 4:
```javascript
React.createElement('div', { className: 'text-gray-500' }, 'Settings content placeholder')
```

Replace with the full tab content:

```javascript
// Installed Resolvers Tab
settingsTab === 'installed' && React.createElement('div', null,
  // Header
  React.createElement('div', { className: 'flex items-center justify-between mb-8' },
    React.createElement('div', null,
      React.createElement('h2', { className: 'text-xl font-semibold text-gray-900' }, 'Installed Resolvers'),
      React.createElement('p', { className: 'text-sm text-gray-500 mt-1' },
        'Select the platforms you want to stream music from. Parachord works better when more services are activated.'
      )
    ),
    // Add from file button
    React.createElement('button', {
      onClick: handleInstallResolver,
      className: 'px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2'
    },
      React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
        React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' })
      ),
      'Add from file'
    )
  ),
  // Resolver grid
  React.createElement('div', {
    className: 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6'
  },
    resolverOrder.map((resolverId, index) => {
      const resolver = allResolvers.find(r => r.id === resolverId);
      if (!resolver) return null;

      const isActive = activeResolvers.includes(resolver.id);

      return React.createElement(ResolverCard, {
        key: resolver.id,
        resolver: resolver,
        isActive: isActive,
        showToggle: true,
        draggable: true,
        onToggle: () => toggleResolver(resolver.id),
        onDragStart: (e) => handleResolverDragStart(e, resolver.id),
        onDragOver: handleResolverDragOver,
        onDrop: (e) => handleResolverDrop(e, resolver.id),
        onDragEnd: handleResolverDragEnd,
        onContextMenu: (e) => {
          e.preventDefault();
          if (window.electron?.resolvers?.showContextMenu) {
            window.electron.resolvers.showContextMenu(resolver.id);
          }
        }
      });
    })
  )
),

// Marketplace Tab
settingsTab === 'marketplace' && React.createElement('div', { className: 'text-gray-500 text-center py-12' },
  'Marketplace content - next task'
),

// General Tab (placeholder)
settingsTab === 'general' && React.createElement('div', {
  className: 'flex items-center justify-center h-64 text-gray-400'
}, 'General settings coming soon'),

// About Tab (placeholder)
settingsTab === 'about' && React.createElement('div', {
  className: 'flex items-center justify-center h-64 text-gray-400'
}, 'About coming soon')
```

**Step 2: Verify installed resolvers tab works**

Run: Navigate to Settings, verify resolver cards display in grid and clicking toggles them.

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat: implement Installed Resolvers tab with card grid"
```

---

## Task 7: Implement Marketplace Tab Content

**Files:**
- Modify: `app.js` (marketplace tab section from Task 6)

**Step 1: Replace marketplace placeholder with full content**

Find the marketplace placeholder:
```javascript
settingsTab === 'marketplace' && React.createElement('div', { className: 'text-gray-500 text-center py-12' },
  'Marketplace content - next task'
),
```

Replace with:

```javascript
settingsTab === 'marketplace' && React.createElement('div', null,
  // Header with search
  React.createElement('div', { className: 'flex items-center justify-between mb-8' },
    React.createElement('div', null,
      React.createElement('h2', { className: 'text-xl font-semibold text-gray-900' }, 'Marketplace'),
      React.createElement('p', { className: 'text-sm text-gray-500 mt-1' },
        'Discover and install new resolver plugins.'
      )
    )
  ),
  // Search and filter bar
  React.createElement('div', { className: 'flex gap-4 mb-8' },
    React.createElement('input', {
      type: 'text',
      placeholder: 'Search resolvers...',
      value: marketplaceSearchQuery,
      onChange: (e) => setMarketplaceSearchQuery(e.target.value),
      className: 'flex-1 max-w-md px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent'
    }),
    React.createElement('select', {
      value: marketplaceCategory,
      onChange: (e) => setMarketplaceCategory(e.target.value),
      className: 'px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent'
    },
      React.createElement('option', { value: 'all' }, 'All Categories'),
      React.createElement('option', { value: 'streaming' }, 'Streaming'),
      React.createElement('option', { value: 'purchase' }, 'Purchase'),
      React.createElement('option', { value: 'metadata' }, 'Metadata'),
      React.createElement('option', { value: 'radio' }, 'Radio')
    )
  ),
  // Loading state
  marketplaceLoading && React.createElement('div', {
    className: 'text-center py-12 text-gray-500'
  }, 'Loading marketplace...'),
  // Empty state
  !marketplaceLoading && marketplaceManifest && marketplaceManifest.resolvers.length === 0 &&
    React.createElement('div', {
      className: 'text-center py-12 text-gray-400'
    }, 'No resolvers available in marketplace yet.'),
  // Resolver grid
  !marketplaceLoading && marketplaceManifest && marketplaceManifest.resolvers.length > 0 &&
    React.createElement('div', {
      className: 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6'
    },
      marketplaceManifest.resolvers
        .filter(resolver => {
          if (marketplaceSearchQuery) {
            const query = marketplaceSearchQuery.toLowerCase();
            const matchesName = resolver.name.toLowerCase().includes(query);
            const matchesDesc = resolver.description.toLowerCase().includes(query);
            const matchesAuthor = resolver.author.toLowerCase().includes(query);
            if (!matchesName && !matchesDesc && !matchesAuthor) return false;
          }
          if (marketplaceCategory !== 'all' && resolver.category !== marketplaceCategory) {
            return false;
          }
          return true;
        })
        .map(resolver => {
          const isInstalled = allResolvers.some(r => r.id === resolver.id);
          const isInstalling = installingResolvers.has(resolver.id);
          const installedVersion = allResolvers.find(r => r.id === resolver.id)?.version;
          const hasUpdate = isInstalled && installedVersion !== resolver.version;

          return React.createElement(ResolverCard, {
            key: resolver.id,
            resolver: resolver,
            isInstalled: isInstalled,
            hasUpdate: hasUpdate,
            isInstalling: isInstalling,
            showInstall: true,
            onInstall: () => handleInstallFromMarketplace(resolver)
          });
        })
    )
),
```

**Step 2: Verify marketplace tab works**

Run: Navigate to Settings > Marketplace, verify cards display and install buttons work.

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat: implement Marketplace tab with card grid"
```

---

## Task 8: Clean Up and Polish

**Files:**
- Modify: `app.js`

**Step 1: Remove any remaining showSettings references**

Search for `showSettings` and remove any remaining usages (should be none after Task 1-3, but verify).

**Step 2: Update the main content area header for settings view**

Find the header title logic around line 5427-5430:
```javascript
activeView === 'library' ? 'My Library' :
activeView === 'playlists' ? 'Playlists' :
```

Add settings case:
```javascript
activeView === 'settings' ? '' :
```

(Settings page has its own header so we don't need a title in the main header)

**Step 3: Ensure settings tab resets to 'installed' when navigating away and back**

In the navigateTo function, add logic to reset settingsTab when navigating to settings:

Find `navigateTo` function and add after setting the view:
```javascript
if (view === 'settings') {
  setSettingsTab('installed');
}
```

**Step 4: Test full flow**

Run:
- Click Settings in sidebar
- Verify vertical tabs work
- Verify Installed Resolvers shows card grid
- Verify Marketplace shows card grid
- Verify General shows placeholder
- Verify About shows placeholder
- Verify back button works to return to previous view
- Verify clicking other sidebar items navigates away

**Step 5: Commit**

```bash
git add app.js
git commit -m "feat: polish settings page and clean up"
```

---

## Summary

After completing all tasks:
1. Settings is now a full-page view accessible via sidebar
2. Vertical tabs on left side: Installed Resolvers, Marketplace, General, About
3. Resolver cards use Tomahawk-style colored squares with centered icons
4. Navigation back/forward buttons work naturally
5. Placeholder tabs for future settings
