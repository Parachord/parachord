#!/bin/bash
# Quick Setup Script for Harmonix Resolver System

echo "🎸 Harmonix Resolver Setup"
echo "=========================="
echo ""

# Check if we're in the harmonix-desktop directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Run this from your harmonix-desktop directory"
    exit 1
fi

# Create directories
echo "📁 Creating resolver directories..."
mkdir -p resolvers/builtin
mkdir -p resolvers/user

# Check if .axe files exist in current directory
if [ -f "spotify.axe" ]; then
    echo "✅ Found .axe files in current directory"
    echo "📦 Moving .axe files to resolvers/builtin/..."
    mv *.axe resolvers/builtin/ 2>/dev/null
else
    echo "⚠️  No .axe files found in current directory"
    echo ""
    echo "You need to copy the .axe files to resolvers/builtin/"
    echo "Required files:"
    echo "  - spotify.axe"
    echo "  - bandcamp.axe"
    echo "  - qobuz.axe"
    echo "  - musicbrainz.axe"
    echo ""
    echo "Download them from the outputs folder and run:"
    echo "  cp /path/to/*.axe resolvers/builtin/"
fi

# Verify structure
echo ""
echo "📋 Checking directory structure..."
if [ -d "resolvers/builtin" ]; then
    echo "✅ resolvers/builtin/ exists"
    
    # Count .axe files
    axe_count=$(ls -1 resolvers/builtin/*.axe 2>/dev/null | wc -l)
    echo "   Found $axe_count .axe file(s)"
    
    if [ $axe_count -eq 4 ]; then
        echo "✅ All 4 required .axe files present!"
        echo ""
        echo "🎉 Setup complete! Run: npm start"
    else
        echo "⚠️  Expected 4 .axe files, found $axe_count"
        echo ""
        echo "Missing files should be in resolvers/builtin/:"
        ls -1 resolvers/builtin/ 2>/dev/null || echo "  (directory empty)"
    fi
else
    echo "❌ resolvers/builtin/ not created"
fi

if [ -d "resolvers/user" ]; then
    echo "✅ resolvers/user/ exists"
else
    echo "❌ resolvers/user/ not created"
fi

echo ""
echo "=========================="
echo "Directory structure should be:"
echo "harmonix-desktop/"
echo "├── app.js"
echo "├── index.html"
echo "├── main.js"
echo "├── preload.js"
echo "├── resolver-loader.js"
echo "└── resolvers/"
echo "    ├── builtin/"
echo "    │   ├── spotify.axe"
echo "    │   ├── bandcamp.axe"
echo "    │   ├── qobuz.axe"
echo "    │   └── musicbrainz.axe"
echo "    └── user/"
