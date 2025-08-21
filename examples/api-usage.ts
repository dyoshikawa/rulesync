// eslint-disable no-console

// Example: Using rulesync programmatic API
import { initialize, generate, getStatus, getSupportedTools } from '../dist/api/index.js';

async function main() {
  try {
    console.log('🚀 Rulesync Programmatic API Example\n');

    // 1. Show supported tools
    const tools = getSupportedTools();
    console.log('📋 Supported AI tools:');
    tools.forEach(tool => {
      const features = Object.entries(tool.features)
        .filter(([_, supported]) => supported)
        .map(([feature]) => feature)
        .join(', ');
      console.log(`  • ${tool.displayName} (${tool.name}): ${features}`);
    });
    console.log();

    // 2. Check initial status
    console.log('📊 Checking project status...');
    let status = await getStatus();
    console.log(`  Initialized: ${status.isInitialized}`);
    console.log(`  Rules files: ${status.rulesStatus.totalFiles}`);
    console.log();

    // 3. Initialize if not already done
    if (!status.isInitialized) {
      console.log('🔧 Initializing rulesync project...');
      const initResult = await initialize();
      console.log(`  Created files: ${initResult.createdFiles.length}`);
      initResult.createdFiles.forEach(file => {
        console.log(`    - ${file}`);
      });
      console.log();
    }

    // 4. Generate configurations for multiple tools
    console.log('⚙️ Generating configurations...');
    const generateResult = await generate({
      tools: ['cursor', 'claudecode', 'copilot'],
      verbose: false
    });

    console.log(`  Generated ${generateResult.summary.successCount} files successfully`);
    if (generateResult.summary.errorCount > 0) {
      console.log(`  ${generateResult.summary.errorCount} files failed to generate`);
      generateResult.generatedFiles
        .filter(f => f.status === 'error')
        .forEach(f => console.log(`    ❌ ${f.tool}: ${f.error}`));
    }

    console.log('\n  Generated files:');
    generateResult.generatedFiles
      .filter(f => f.status === 'success')
      .forEach(f => console.log(`    ✅ ${f.tool} ${f.type}: ${f.path}`));

    // 5. Final status check
    console.log('\n📊 Final project status:');
    status = await getStatus();
    console.log(`  Rules files: ${status.rulesStatus.totalFiles}`);
    console.log(`  Generated for ${status.generatedFilesStatus.length} tools`);

    console.log('\n🎉 API example completed successfully!');

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
    if (error && typeof error === 'object' && 'details' in error) {
      console.error('Details:', error.details);
    }
    process.exit(1);
  }
}

main().catch(console.error);