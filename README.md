# Goldilox 🐻 - Constrained Legal Reasoning System

**Patent-Protected RAG Controller** | Zero Hallucinations | Path-Based Retrieval

A Next.js application implementing an external controller for constraining probabilistic text generation using structured logic files (.bset format). Based on US Provisional Patent Application filed December 26, 2025.

## 🎯 What Is This?

**The LLM is just a language interface** - it doesn't add knowledge, it only constructs natural language from your `.bset` file.

```
Your .bset File → Goldilox Controller → LLM → Validated Output
                  ↓
        (Path-based retrieval)
        (Citation verification)
        (Constraint enforcement)
```

### Key Innovation

- ✅ **Zero Hallucinations** - LLM can only cite cases in your .bset file
- ✅ **Deterministic Retrieval** - Same query = same reasoning context  
- ✅ **Reproducible Validation** - Citations verified against authorized fields
- ✅ **Audit Trail** - Every assertion traces to specific case/statute
- ✅ **Model Agnostic** - Works with any LLM (currently Claude Sonnet 4)

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ 
- Anthropic API key ([get one](https://console.anthropic.com/))
- A `.bset` file from briefica

### Installation

```bash
# 1. Navigate to your projects folder
cd ~/Projects

# 2. Extract goldilox folder here

# 3. Install dependencies
cd goldilox
npm install

# 4. Create environment file
cp .env.example .env.local

# 5. Add your API key
# Edit .env.local and add:
# ANTHROPIC_API_KEY=sk-ant-your-actual-key

# 6. Run development server
npm run dev

# 7. Open http://localhost:3001
```

### First Test

1. Open http://localhost:3001
2. Upload your `.bset` file (e.g., `CrimPro.bset`)
3. Ask: "Was the listening device used by the informant a Fourth Amendment search?"
4. Goldilox responds using ONLY cases from your .bset file!

## 📂 Project Structure

```
goldilox/
├── src/
│   ├── types/
│   │   └── bset.ts              # .bset format types
│   ├── lib/
│   │   ├── controller.ts        # External controller (Patent FIG. 4)
│   │   └── validation.ts        # Validation engine (Patent §280-293)
│   └── app/
│       ├── api/generate/
│       │   └── route.ts         # API with iterative validation
│       ├── page.tsx             # Goldilox UI
│       └── layout.tsx
├── package.json
├── tsconfig.json
├── next.config.ts
└── README.md
```

## 🧬 How It Works

### Step 1: Path-Based Retrieval

```typescript
// Query: "Was the listening device a search?"
// 
// Controller finds best matching node via TF-IDF:
//   "The Fourth Amendment" → "Is there a search or seizure?" → "Was there a search?"
//
// Computes path: ["476d4a58...", "a4839265...", "c3d7a8f2..."]
```

### Step 2: Prefix Matching

```typescript
// Retrieves cases where taxonomy_path matches or is prefix of computed path:
//
// EXACT MATCH:
//   United States v. White ["476d", "a483", "c3d7"] ✓
//
// INHERITED:
//   Katz v. United States ["476d", "a483"] ✓
//   Fourth Amendment ["476d"] ✓
//
// NOT RETRIEVED:
//   Riley v. California ["476d", "xyz789"] ✗ (different branch)
```

### Step 3: Constraint Enforcement

```typescript
// Goldilox is instructed to:
// - ONLY cite: White, Katz, Fourth Amendment
// - MUST apply: Katz two-prong test
// - MUST address: Required elements 1-2
```

### Step 4: Validation

```typescript
// Citation Check:
//   Extract: "United States v. White"
//   Verify: Exists in authorized_objects ✓ PASS
//
// Rule-to-Field Mapping:
//   Extract: "A search occurs when..."
//   Compare to case.rule_of_law via cosine similarity
//   Threshold 0.75 → 0.89 ✓ PASS
//
// Constraint Compliance:
//   Required element "government knowledge" 
//   Found in output ✓ PASS
```

## 🎨 Features

### For Users
- 🐻 **Goldilox Personality** - Friendly assistant using only your knowledge
- ✅ **Zero Hallucinations** - Can't cite non-existent cases
- 📊 **Transparent Reasoning** - See exactly which cases were used
- 📋 **Validation Reports** - Detailed verification breakdown

### For Developers
- 🔄 **Model Agnostic** - Swap LLMs without changing logic
- 🎯 **Deterministic** - Same input = same context
- 📝 **Audit Trail** - Every decision logged
- 💪 **TypeScript** - Full type safety

## 📖 API Reference

### POST /api/generate

```json
Request:
{
  "query": "Was the listening device a search?",
  "bset_file": { ... }
}

Response:
{
  "generated_text": "I, Goldilox, analyzed...",
  "validation_report": {
    "overall_status": "PASSED",
    "validation_checks": [...]
  },
  "status": "validated",
  "authorized_context": {...},
  "iterations": 1
}
```

## 🚀 Deployment to Vercel

See `DEPLOYMENT.md` for complete deployment guide.

Quick deploy:
1. Push to GitHub
2. Import to Vercel
3. Add `ANTHROPIC_API_KEY` environment variable
4. Deploy!

## 📜 Patent Information

**US Provisional Patent Application**  
Title: *Systems and Methods for Structured Logic Artifacts and Constrained Computational Analysis*  
Filed: December 26, 2025  
Inventor: Williams, Noah Amiel

This software implements the patent-pending system for external constraint enforcement on probabilistic text generation.

## 🤝 Support

For issues or questions:
- Open an issue on GitHub
- Check documentation in `/docs`
- Contact: [your-email]

---

**Made with 🐻 by Goldilox**  
*Just right - no hallucinations, just facts from your knowledge base.*
