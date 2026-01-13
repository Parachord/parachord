#!/usr/bin/env node
// Tomahawk Resolver to Harmonix .axe Converter
// Usage: node tomahawk-to-axe.js spotify-resolver.js

const fs = require('fs');
const path = require('path');

if (process.argv.length < 3) {
  console.error('Usage: node tomahawk-to-axe.js <tomahawk-resolver.js>');
  process.exit(1);
}

const inputFile = process.argv[2];
const outputFile = inputFile.replace(/\.js$/, '.axe');

console.log('🔄 Converting Tomahawk resolver to .axe format...');
console.log('Input:', inputFile);
console.log('Output:', outputFile);

// Read Tomahawk resolver
const tomahawkCode = fs.readFileSync(inputFile, 'utf8');

// Extract resolver metadata
const nameMatch = tomahawkCode.match(/name:\s*['"]([^'"]+)['"]/);
const iconMatch = tomahawkCode.match(/icon:\s*['"]([^'"]+)['"]/);
const weightMatch = tomahawkCode.match(/weight:\s*(\d+)/);

// Extract functions (basic pattern matching - may need refinement)
const resolveFnMatch = tomahawkCode.match(/resolve:\s*function\s*\([^)]*\)\s*{([\s\S]*?)(?=,\s*\w+:|}\s*\);)/);
const searchFnMatch = tomahawkCode.match(/search:\s*function\s*\([^)]*\)\s*{([\s\S]*?)(?=,\s*\w+:|}\s*\);)/);

if (!nameMatch) {
  console.error('❌ Could not extract resolver name');
  process.exit(1);
}

const resolverName = nameMatch[1];
const resolverId = resolverName.toLowerCase().replace(/\s+/g, '-');

console.log('📦 Resolver:', resolverName);
console.log('🔑 ID:', resolverId);

// Create .axe structure
const axe = {
  manifest: {
    id: resolverId,
    name: resolverName,
    version: '1.0.0',
    author: 'Converted from Tomahawk',
    description: `${resolverName} resolver (converted from Tomahawk)`,
    icon: iconMatch ? iconMatch[1] : '🎵',
    color: '#6366F1'
  },
  capabilities: {
    resolve: !!resolveFnMatch,
    search: !!searchFnMatch,
    stream: true,
    browse: false,
    urlLookup: false
  },
  settings: {
    requiresAuth: false,
    authType: 'none',
    configurable: {}
  },
  implementation: {}
};

// Convert functions
console.log('\n⚠️  MANUAL CONVERSION REQUIRED:');
console.log('The following functions need manual conversion from Tomahawk API to standard JS:');
console.log('');

if (resolveFnMatch) {
  console.log('📝 Resolve function found - needs conversion:');
  console.log('   - Replace Tomahawk.asyncRequest() with fetch()');
  console.log('   - Replace Tomahawk.addTrackResults() with return statement');
  console.log('   - Convert callbacks to async/await');
  console.log('   - Update parameter names: (qid, artist, album, title) → (artist, track, album, config)');
  console.log('');
  
  // Placeholder - manual conversion needed
  axe.implementation.resolve = "async function(artist, track, album, config) { /* TODO: Convert from Tomahawk format - see original code */ throw new Error('Manual conversion required'); }";
}

if (searchFnMatch) {
  console.log('🔍 Search function found - needs conversion:');
  console.log('   - Replace Tomahawk.asyncRequest() with fetch()');
  console.log('   - Replace Tomahawk.addTrackResults() with return statement');
  console.log('   - Convert callbacks to async/await');
  console.log('   - Update parameter names: (qid, searchString) → (query, config)');
  console.log('');
  
  // Placeholder - manual conversion needed
  axe.implementation.search = "async function(query, config) { /* TODO: Convert from Tomahawk format - see original code */ throw new Error('Manual conversion required'); }";
}

console.log('💡 Conversion steps:');
console.log('   1. Open both files side-by-side');
console.log('   2. Copy the logic from Tomahawk functions');
console.log('   3. Replace Tomahawk APIs with standard JavaScript:');
console.log('      - Tomahawk.asyncRequest() → fetch()');
console.log('      - Tomahawk.addTrackResults() → return array');
console.log('      - Callbacks → async/await');
console.log('   4. Test the resolver in Harmonix');
console.log('');

// Write .axe file
fs.writeFileSync(outputFile, JSON.stringify(axe, null, 2));

console.log(`✅ Created ${outputFile}`);
console.log('⚠️  This is a TEMPLATE - manual conversion of functions is required!');
console.log('');
console.log('Original Tomahawk code has been preserved in:', inputFile);

// Write a conversion guide
const guideFile = outputFile.replace('.axe', '-conversion-guide.md');
const guide = `# Conversion Guide: ${resolverName}

## Original Tomahawk Resolver
\`${inputFile}\`

## Target .axe Format
\`${outputFile}\`

## Functions to Convert

${resolveFnMatch ? `### Resolve Function

**Original:**
\`\`\`javascript
${resolveFnMatch[0]}
\`\`\`

**Convert to:**
\`\`\`javascript
async function(artist, track, album, config) {
  // 1. Replace Tomahawk.asyncRequest with fetch
  const response = await fetch(url);
  const data = await response.json();
  
  // 2. Process results
  const results = data.items.map(item => ({
    id: 'prefix-' + item.id,
    title: item.name,
    artist: item.artist,
    album: item.album,
    duration: item.duration,
    sources: ['${resolverId}']
  }));
  
  // 3. Return results (not Tomahawk.addTrackResults)
  return results[0] || null;
}
\`\`\`
` : ''}

${searchFnMatch ? `### Search Function

**Original:**
\`\`\`javascript
${searchFnMatch[0]}
\`\`\`

**Convert to:**
\`\`\`javascript
async function(query, config) {
  // 1. Replace Tomahawk.asyncRequest with fetch
  const response = await fetch(url);
  const data = await response.json();
  
  // 2. Process results
  const results = data.items.map(item => ({
    id: 'prefix-' + item.id,
    title: item.name,
    artist: item.artist,
    album: item.album,
    duration: item.duration,
    sources: ['${resolverId}']
  }));
  
  // 3. Return results array
  return results;
}
\`\`\`
` : ''}

## Common Conversions

### API Calls
\`\`\`javascript
// Tomahawk → Harmonix
Tomahawk.asyncRequest(url, callback) → await fetch(url)
Tomahawk.addTrackResults(results) → return results
Tomahawk.log(msg) → console.log(msg)
\`\`\`

### Callbacks → Async/Await
\`\`\`javascript
// Before
Tomahawk.asyncRequest(url, function(response) {
  var data = JSON.parse(response);
  processData(data);
});

// After
const response = await fetch(url);
const data = await response.json();
return processData(data);
\`\`\`

### Result Format
\`\`\`javascript
// Tomahawk format
{
  artist: "Artist Name",
  track: "Track Name",
  source: "Spotify",
  url: "spotify:track:123"
}

// Harmonix format
{
  id: "spotify-123",
  title: "Track Name",
  artist: "Artist Name",
  album: "Album Name",
  duration: 180,
  sources: ["spotify"],
  spotifyUri: "spotify:track:123"
}
\`\`\`

## Testing

1. Complete the conversion
2. Validate JSON: \`cat ${outputFile} | jq\`
3. Install in Harmonix: Settings → Install New Resolver
4. Test search and playback

## Notes

- The original Tomahawk resolver is in \`${inputFile}\`
- This .axe file needs manual completion before it will work
- Focus on converting the logic, not just copy/paste
- Test thoroughly after conversion
`;

fs.writeFileSync(guideFile, guide);
console.log(`📖 Conversion guide written to: ${guideFile}`);
