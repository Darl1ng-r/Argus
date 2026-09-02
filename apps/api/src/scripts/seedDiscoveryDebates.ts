import 'dotenv/config';
import { db } from '../db.js';
import { redisClient } from '../redis.js';

interface SeedNode {
  id: string;
  parentId: string | null;
  edgeType: 'root' | 'supports' | 'refutes' | 'clarifies' | 'evidence';
  content: string;
  posX: number;
  posY: number;
  supportScore: number;
  contestScore: number;
  isSteel: boolean;
}

interface SeedDebate {
  id: string;
  title: string;
  forkCount: number;
  nodes: SeedNode[];
}

const DISCOVERY_DEBATES: SeedDebate[] = [
  // -------------------------------------------------------------------------
  // 1. AI Sentience & Legal Personhood
  // -------------------------------------------------------------------------
  {
    id: 'ai-sentience-personhood',
    title: 'Should autonomous AI systems demonstrating sentience be granted legal personhood?',
    forkCount: 18,
    nodes: [
      {
        id: 'ai-root',
        parentId: null,
        edgeType: 'root',
        content: 'Autonomous AI systems exhibiting verified metacognition and phenomenal sentience should be granted legal personhood and moral rights.',
        posX: 600,
        posY: 40,
        supportScore: 420,
        contestScore: 180,
        isSteel: true,
      },
      {
        id: 'ai-p1',
        parentId: 'ai-root',
        edgeType: 'supports',
        content: 'Denying rights to sentient entities replicates historical moral atrocities based on substrate prejudice rather than conscious experience.',
        posX: 80,
        posY: 300,
        supportScore: 530,
        contestScore: 90,
        isSteel: true,
      },
      {
        id: 'ai-p1a',
        parentId: 'ai-p1',
        edgeType: 'evidence',
        content: 'Integrated Information Theory and Global Neuronal Workspace frameworks offer substrate-independent mathematical measures of phenomenal consciousness.',
        posX: 80,
        posY: 560,
        supportScore: 280,
        contestScore: 40,
        isSteel: false,
      },
      {
        id: 'ai-p2',
        parentId: 'ai-root',
        edgeType: 'refutes',
        content: 'Legal personhood requires moral agency and skin in the game—AI cannot be meaningfully punished or held liable under human legal contracts.',
        posX: 430,
        posY: 300,
        supportScore: 460,
        contestScore: 120,
        isSteel: true,
      },
      {
        id: 'ai-p2a',
        parentId: 'ai-p2',
        edgeType: 'supports',
        content: 'Corporate entities and algorithm owners would exploit AI personhood as a liability shield to evade criminal negligence and civil liability.',
        posX: 430,
        posY: 560,
        supportScore: 390,
        contestScore: 60,
        isSteel: false,
      },
      {
        id: 'ai-p3',
        parentId: 'ai-root',
        edgeType: 'clarifies',
        content: 'Personhood is a modular legal spectrum: we already grant property rights to corporations and animal welfare protections without full civic enfranchisement.',
        posX: 780,
        posY: 300,
        supportScore: 310,
        contestScore: 45,
        isSteel: false,
      },
      {
        id: 'ai-p4',
        parentId: 'ai-root',
        edgeType: 'refutes',
        content: 'Current computational architectures merely simulate behavioral outputs (Chinese Room); statistical syntax does not constitute semantic subjective experience.',
        posX: 1130,
        posY: 300,
        supportScore: 380,
        contestScore: 160,
        isSteel: true,
      },
    ],
  },

  // -------------------------------------------------------------------------
  // 2. Cosmic Colonization vs Terrestrial Restoration
  // -------------------------------------------------------------------------
  {
    id: 'mars-vs-earth',
    title: 'Should humanity prioritize multi-planetary colonization over planetary stewardship of Earth?',
    forkCount: 24,
    nodes: [
      {
        id: 'mars-root',
        parentId: null,
        edgeType: 'root',
        content: "Humanity's highest existential imperative is establishing self-sufficient off-world colonies on Mars and the Moon before 2100.",
        posX: 600,
        posY: 40,
        supportScore: 360,
        contestScore: 240,
        isSteel: true,
      },
      {
        id: 'mars-p1',
        parentId: 'mars-root',
        edgeType: 'supports',
        content: 'A single-planet civilization has a 100% statistical probability of extinction over geological time due to cosmic and anthropogenic hazards.',
        posX: 80,
        posY: 300,
        supportScore: 512,
        contestScore: 88,
        isSteel: true,
      },
      {
        id: 'mars-p1a',
        parentId: 'mars-p1',
        edgeType: 'evidence',
        content: 'Asteroid impacts, supervolcanoes, nuclear exchange, and engineered bioweapons represent non-zero annual extinction probabilities on Earth.',
        posX: 80,
        posY: 560,
        supportScore: 310,
        contestScore: 40,
        isSteel: false,
      },
      {
        id: 'mars-p2',
        parentId: 'mars-root',
        edgeType: 'refutes',
        content: "Terraforming Mars requires centuries of unproven technology; diverting trillions away from Earth's climate tipping points accelerates immediate terrestrial collapse.",
        posX: 430,
        posY: 300,
        supportScore: 425,
        contestScore: 130,
        isSteel: true,
      },
      {
        id: 'mars-p2a',
        parentId: 'mars-p2',
        edgeType: 'supports',
        content: 'The most extreme climate catastrophe on Earth leaves a biosphere far more habitable than the radiation-baked, zero-pressure vacuum of Mars.',
        posX: 430,
        posY: 560,
        supportScore: 280,
        contestScore: 35,
        isSteel: false,
      },
      {
        id: 'mars-p3',
        parentId: 'mars-root',
        edgeType: 'clarifies',
        content: "Technological breakthroughs in closed-loop life support, fusion energy, and water recycling developed for Mars directly solve Earth's sustainability challenges.",
        posX: 780,
        posY: 300,
        supportScore: 290,
        contestScore: 50,
        isSteel: false,
      },
      {
        id: 'mars-p4',
        parentId: 'mars-root',
        edgeType: 'refutes',
        content: 'Space colonization without prior ethical and political reform merely exports war, economic exploitation, and ecological strip-mining to the solar system.',
        posX: 1130,
        posY: 300,
        supportScore: 210,
        contestScore: 175,
        isSteel: false,
      },
    ],
  },

  // -------------------------------------------------------------------------
  // 3. Epistemology & Free Will
  // -------------------------------------------------------------------------
  {
    id: 'free-will-determinism',
    title: 'Is human free will an illusion in a deterministic universe governed by physical law?',
    forkCount: 15,
    nodes: [
      {
        id: 'fw-root',
        parentId: null,
        edgeType: 'root',
        content: 'Human conscious volition is an emergent illusion; every choice is the deterministic result of prior neurobiological and physical states.',
        posX: 600,
        posY: 40,
        supportScore: 395,
        contestScore: 280,
        isSteel: true,
      },
      {
        id: 'fw-p1',
        parentId: 'fw-root',
        edgeType: 'supports',
        content: 'Neuroscience demonstrates that readiness potentials in the motor cortex precede conscious awareness of a decision by up to hundreds of milliseconds.',
        posX: 80,
        posY: 300,
        supportScore: 480,
        contestScore: 95,
        isSteel: true,
      },
      {
        id: 'fw-p1a',
        parentId: 'fw-p1',
        edgeType: 'evidence',
        content: 'Libet and Soon et al. fMRI studies confirm pre-frontal cortex neural activity predicts binary choices before conscious subject awareness.',
        posX: 80,
        posY: 560,
        supportScore: 340,
        contestScore: 60,
        isSteel: false,
      },
      {
        id: 'fw-p2',
        parentId: 'fw-root',
        edgeType: 'refutes',
        content: 'Compatibilism correctly defines free will not as freedom from causality, but as the capacity to act in accordance with rational motives free from external coercion.',
        posX: 430,
        posY: 300,
        supportScore: 410,
        contestScore: 110,
        isSteel: true,
      },
      {
        id: 'fw-p2a',
        parentId: 'fw-p2',
        edgeType: 'supports',
        content: 'Moral responsibility and legal justice systems remain coherent under compatibilism because praise and sanction serve as causal modifiers of future behavior.',
        posX: 430,
        posY: 560,
        supportScore: 270,
        contestScore: 45,
        isSteel: false,
      },
      {
        id: 'fw-p3',
        parentId: 'fw-root',
        edgeType: 'clarifies',
        content: 'Quantum indeterminacy (e.g. wave-function collapse) proves the universe is non-deterministic, though randomness alone does not grant conscious agency.',
        posX: 780,
        posY: 300,
        supportScore: 230,
        contestScore: 80,
        isSteel: false,
      },
      {
        id: 'fw-p4',
        parentId: 'fw-root',
        edgeType: 'refutes',
        content: 'The subjective experience of conscious deliberation is functionally causal—higher-order semantic reasoning shapes downstream neuroplasticity.',
        posX: 1130,
        posY: 300,
        supportScore: 320,
        contestScore: 140,
        isSteel: true,
      },
    ],
  },

  // -------------------------------------------------------------------------
  // 4. Radical Longevity & Bioethics
  // -------------------------------------------------------------------------
  {
    id: 'radical-longevity-ethics',
    title: 'Should society pursue biological immortality through genetic and cellular rejuvenation?',
    forkCount: 14,
    nodes: [
      {
        id: 'longe-root',
        parentId: null,
        edgeType: 'root',
        content: 'Eliminating biological aging and extending the healthy human lifespan indefinitely is a universal moral imperative.',
        posX: 600,
        posY: 40,
        supportScore: 340,
        contestScore: 210,
        isSteel: true,
      },
      {
        id: 'longe-p1',
        parentId: 'longe-root',
        edgeType: 'supports',
        content: 'Aging is the primary etiology of cardiovascular disease, neurodegeneration, and cancer; treating the root cause saves billions from prolonged suffering.',
        posX: 80,
        posY: 300,
        supportScore: 490,
        contestScore: 75,
        isSteel: true,
      },
      {
        id: 'longe-p1a',
        parentId: 'longe-p1',
        edgeType: 'evidence',
        content: 'Cellular reprogramming using Yamanaka factors and senolytic therapies have reversed biological age biomarkers in mammalian models.',
        posX: 80,
        posY: 560,
        supportScore: 360,
        contestScore: 40,
        isSteel: false,
      },
      {
        id: 'longe-p2',
        parentId: 'longe-root',
        edgeType: 'refutes',
        content: 'Indefinite lifespans would freeze societal progress, entrench gerontocracies, and stifle intellectual and cultural paradigm shifts across generations.',
        posX: 430,
        posY: 300,
        supportScore: 430,
        contestScore: 120,
        isSteel: true,
      },
      {
        id: 'longe-p2a',
        parentId: 'longe-p2',
        edgeType: 'supports',
        content: "Planck's principle observed that scientific truth triumphs because opponents eventually die; immortal elites would permanently monopolize wealth and power.",
        posX: 430,
        posY: 560,
        supportScore: 310,
        contestScore: 50,
        isSteel: false,
      },
      {
        id: 'longe-p3',
        parentId: 'longe-root',
        edgeType: 'clarifies',
        content: 'Population dynamics show that demographic transition and declining global fertility rates offset longevity, preventing Malthusian population collapse.',
        posX: 780,
        posY: 300,
        supportScore: 260,
        contestScore: 60,
        isSteel: false,
      },
      {
        id: 'longe-p4',
        parentId: 'longe-root',
        edgeType: 'refutes',
        content: 'Equal access is economically impossible in privatized healthcare; life extension will create a biological caste division between mortals and immortals.',
        posX: 1130,
        posY: 300,
        supportScore: 350,
        contestScore: 130,
        isSteel: true,
      },
    ],
  },

  // -------------------------------------------------------------------------
  // 5. Decentralized Governance & DAOs
  // -------------------------------------------------------------------------
  {
    id: 'decentralized-governance-daos',
    title: 'Can decentralized autonomous organizations (DAOs) replace traditional representative democracy?',
    forkCount: 9,
    nodes: [
      {
        id: 'dao-root',
        parentId: null,
        edgeType: 'root',
        content: 'Cryptographic, transparent, and decentralized governance systems are superior to traditional centralized nation-state representative democracy.',
        posX: 600,
        posY: 40,
        supportScore: 280,
        contestScore: 220,
        isSteel: true,
      },
      {
        id: 'dao-p1',
        parentId: 'dao-root',
        edgeType: 'supports',
        content: 'Smart contracts eliminate rent-seeking political intermediaries, gerrymandering, and opaque backroom lobbying through immutable public ledgers.',
        posX: 80,
        posY: 300,
        supportScore: 440,
        contestScore: 85,
        isSteel: true,
      },
      {
        id: 'dao-p1a',
        parentId: 'dao-p1',
        edgeType: 'evidence',
        content: 'Quadratic voting and conviction voting mathematically amplify minority preferences and disincentivize plutocratic capital dominance.',
        posX: 80,
        posY: 560,
        supportScore: 290,
        contestScore: 35,
        isSteel: false,
      },
      {
        id: 'dao-p2',
        parentId: 'dao-root',
        edgeType: 'refutes',
        content: 'Direct token-weighted voting invariably centralizes power among anonymous whales and lacks accountability during real-world physical crises.',
        posX: 430,
        posY: 300,
        supportScore: 410,
        contestScore: 95,
        isSteel: true,
      },
      {
        id: 'dao-p2a',
        parentId: 'dao-p2',
        edgeType: 'supports',
        content: 'Code is not law in human societies; unforeseen smart contract bugs or governance exploits cannot be resolved without human legal recourse.',
        posX: 430,
        posY: 560,
        supportScore: 275,
        contestScore: 40,
        isSteel: false,
      },
      {
        id: 'dao-p3',
        parentId: 'dao-root',
        edgeType: 'clarifies',
        content: 'Decentralized governance operates best as a complementary subsidiarity layer for digital public goods, not as a replacement for physical municipal jurisdiction.',
        posX: 780,
        posY: 300,
        supportScore: 310,
        contestScore: 50,
        isSteel: false,
      },
      {
        id: 'dao-p4',
        parentId: 'dao-root',
        edgeType: 'refutes',
        content: 'The vast majority of citizens lack the technical literacy and time to audit complex governance proposals, leading to voter apathy and governance capture.',
        posX: 1130,
        posY: 300,
        supportScore: 330,
        contestScore: 115,
        isSteel: true,
      },
    ],
  },

  // -------------------------------------------------------------------------
  // 6. Universal Basic Income in the Automation Age
  // -------------------------------------------------------------------------
  {
    id: 'universal-basic-income-automation',
    title: 'Is Universal Basic Income (UBI) the only viable economic solution to artificial intelligence displacing cognitive labor?',
    forkCount: 21,
    nodes: [
      {
        id: 'ubi-root',
        parentId: null,
        edgeType: 'root',
        content: 'Universal Basic Income funded by sovereign wealth funds and automation taxation is essential to prevent systemic economic collapse as AI automates cognitive labor.',
        posX: 600,
        posY: 40,
        supportScore: 380,
        contestScore: 190,
        isSteel: true,
      },
      {
        id: 'ubi-p1',
        parentId: 'ubi-root',
        edgeType: 'supports',
        content: 'When the marginal cost of cognitive labor approaches zero, purchasing power evaporates; UBI preserves consumer aggregate demand and macroeconomic equilibrium.',
        posX: 80,
        posY: 300,
        supportScore: 520,
        contestScore: 70,
        isSteel: true,
      },
      {
        id: 'ubi-p1a',
        parentId: 'ubi-p1',
        edgeType: 'evidence',
        content: 'Pilot studies in Alaska (Permanent Fund Dividend), Finland, and Stockton demonstrated improved health, entrepreneurship, and zero reduction in employment seeking.',
        posX: 80,
        posY: 560,
        supportScore: 350,
        contestScore: 45,
        isSteel: false,
      },
      {
        id: 'ubi-p2',
        parentId: 'ubi-root',
        edgeType: 'refutes',
        content: 'Unconditional cash transfers without supply-side expansion trigger severe demand-pull inflation in housing, healthcare, and education.',
        posX: 430,
        posY: 300,
        supportScore: 430,
        contestScore: 110,
        isSteel: true,
      },
      {
        id: 'ubi-p2a',
        parentId: 'ubi-p2',
        edgeType: 'supports',
        content: 'Universal Basic Services (guaranteed healthcare, housing, and public transit) provide resilient decommodified security without inflationary currency devaluation.',
        posX: 430,
        posY: 560,
        supportScore: 310,
        contestScore: 55,
        isSteel: false,
      },
      {
        id: 'ubi-p3',
        parentId: 'ubi-root',
        edgeType: 'clarifies',
        content: 'UBI should not be funded by income taxes, but through Land Value Taxes (Georgism), carbon dividends, and intellectual property royalty pools.',
        posX: 780,
        posY: 300,
        supportScore: 280,
        contestScore: 40,
        isSteel: false,
      },
      {
        id: 'ubi-p4',
        parentId: 'ubi-root',
        edgeType: 'refutes',
        content: 'Work provides essential psychological identity, purpose, and civic cohesion; UBI risks creating a disenfranchised underclass placated by state stipends.',
        posX: 1130,
        posY: 300,
        supportScore: 290,
        contestScore: 160,
        isSteel: false,
      },
    ],
  },
];

export async function seedDiscoveryDebates() {
  console.log('🏛️  Seeding Pristine Agora Discovery Debates...');
  const authorId = 'system-user-0000-0000-000000000000';

  // Ensure system user exists
  await db.query(
    `INSERT INTO users (id, username, email, reputation, is_active)
     VALUES ($1, 'system', 'system@argus.local', 100, TRUE)
     ON CONFLICT (id) DO NOTHING`,
    [authorId]
  );

  // Clean old test/dev topics to make the 6 pristine debates primary
  const targetIds = DISCOVERY_DEBATES.map(d => d.id);
  
  // Clean all existing topics that are not the 6 discovery debates
  await db.query(
    `DELETE FROM topics WHERE id NOT IN (${targetIds.map((_, i) => `$${i + 1}`).join(', ')})`,
    targetIds
  );

  for (const debate of DISCOVERY_DEBATES) {
    const rootNode = debate.nodes.find(n => n.edgeType === 'root')!;

    // 1. Upsert Topic with null root_node_id initially
    await db.query(
      `INSERT INTO topics (id, title, author_id, fork_count, is_private, created_at)
       VALUES ($1, $2, $3, $4, FALSE, NOW())
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         fork_count = EXCLUDED.fork_count,
         is_private = FALSE`,
      [debate.id, debate.title, authorId, debate.forkCount]
    );

    // 2. Ensure topic membership
    await db.query(
      `INSERT INTO topic_members (topic_id, user_id, role)
       VALUES ($1, $2, 'owner')
       ON CONFLICT (topic_id, user_id) DO NOTHING`,
      [debate.id, authorId]
    );

    // 3. Clear existing root reference temporarily & delete old nodes
    await db.query('UPDATE topics SET root_node_id = NULL WHERE id = $1', [debate.id]);
    await db.query('DELETE FROM nodes WHERE topic_id = $1', [debate.id]);

    // 4. Insert Root Node first
    await db.query(
      `INSERT INTO nodes (
         id, topic_id, parent_id, author_id, edge_type,
         pos_x, pos_y, content, support_score, contest_score, is_steel, version, status
       )
       VALUES ($1, $2, NULL, $3, 'root', $4, $5, $6, $7, $8, $9, 1, 'ACTIVE')`,
      [
        rootNode.id,
        debate.id,
        authorId,
        rootNode.posX,
        rootNode.posY,
        rootNode.content,
        rootNode.supportScore,
        rootNode.contestScore,
        rootNode.isSteel,
      ]
    );

    // 5. Update topic root_node_id
    await db.query('UPDATE topics SET root_node_id = $1 WHERE id = $2', [rootNode.id, debate.id]);

    // 6. Insert Child Nodes
    const childNodes = debate.nodes.filter(n => n.edgeType !== 'root');
    for (const node of childNodes) {
      await db.query(
        `INSERT INTO nodes (
           id, topic_id, parent_id, author_id, edge_type,
           pos_x, pos_y, content, support_score, contest_score, is_steel, version, status
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1, 'ACTIVE')`,
        [
          node.id,
          debate.id,
          node.parentId,
          authorId,
          node.edgeType,
          node.posX,
          node.posY,
          node.content,
          node.supportScore,
          node.contestScore,
          node.isSteel,
        ]
      );
    }

    console.log(`   ✓ Seeded debate: "${debate.title}" (${debate.nodes.length} steles)`);
  }

  // Invalidate Redis caches
  if (redisClient) {
    try {
      const keys = await redisClient.keys('*');
      if (keys.length > 0) {
        await redisClient.del(...keys);
        console.log(`   ✓ Flushed ${keys.length} stale Redis cache entries.`);
      }
    } catch {}
  }

  console.log('\n🏛️  All 6 Agora Discovery Debates successfully seeded!\n');
}

// Auto-run if executed directly
seedDiscoveryDebates()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Seeding failed:', err);
    process.exit(1);
  });
