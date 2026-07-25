"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrCreateUser = getOrCreateUser;
exports.detectCycle = detectCycle;
exports.getTopicSubgraph = getTopicSubgraph;
exports.getTopic = getTopic;
exports.getAllTopics = getAllTopics;
exports.createTopic = createTopic;
exports.addClaimNode = addClaimNode;
exports.voteNode = voteNode;
exports.forkTopic = forkTopic;
const db_js_1 = require("../db.js");
const sanitizer_js_1 = require("../utils/sanitizer.js");
// -----------------------------------------------------------------------
// Get or Provision User
// -----------------------------------------------------------------------
async function getOrCreateUser(userIdOrClerkId, username, email) {
    const inputId = userIdOrClerkId || 'system-user-0000-0000-000000000000';
    const isClerkId = inputId.startsWith('user_');
    const existing = await db_js_1.db.query('SELECT id, clerk_id AS "clerkId", username, email, reputation FROM users WHERE id = $1 OR clerk_id = $1', [inputId]);
    if (existing.rowCount > 0) {
        return existing.rows[0];
    }
    const name = username ||
        (inputId === 'system-user-0000-0000-000000000000' ? 'system' : `User_${inputId.slice(-6)}`);
    const userEmail = email || `${name.toLowerCase().replace(/[^a-z0-9]/g, '')}@argus.local`;
    let created;
    if (isClerkId) {
        created = await db_js_1.db.query(`INSERT INTO users (clerk_id, username, email, reputation)
       VALUES ($1, $2, $3, 10)
       RETURNING id, clerk_id AS "clerkId", username, email, reputation`, [inputId, name, userEmail]);
    }
    else {
        created = await db_js_1.db.query(`INSERT INTO users (id, username, email, reputation)
       VALUES ($1, $2, $3, 10)
       ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username
       RETURNING id, clerk_id AS "clerkId", username, email, reputation`, [inputId, name, userEmail]);
    }
    return created.rows[0];
}
function rowToNode(row, userVoteMap) {
    const id = row.id;
    return {
        id,
        parent: row.parent_id ?? null,
        edgeType: row.edge_type ?? 'supports',
        x: Number(row.pos_x),
        y: Number(row.pos_y),
        content: row.content,
        support: Number(row.support_score),
        contest: Number(row.contest_score),
        steel: Boolean(row.is_steel),
        userVote: userVoteMap ? userVoteMap.get(id) || null : null,
        authorId: row.author_id || 'system',
        createdAt: row.created_at.toISOString(),
        hasMoreChildren: Boolean(row.has_more_children),
    };
}
// -----------------------------------------------------------------------
// CYCLE DETECTION ENGINE (Recursive CTE)
// -----------------------------------------------------------------------
async function detectCycle(topicId, proposedParentId, proposedChildId) {
    // Direct self-reference is always a cycle
    if (proposedChildId && proposedParentId === proposedChildId) {
        return true;
    }
    // Without a child ID (new node creation), no cycle is possible since
    // a brand-new leaf node has no outgoing edges.
    if (!proposedChildId) {
        return false;
    }
    // Check whether proposedChildId is an ancestor of proposedParentId
    // (i.e., adding edge parent→child would close a cycle)
    const result = await db_js_1.db.query(`WITH RECURSIVE ancestors AS (
       SELECT id, parent_id FROM nodes WHERE id = $1 AND topic_id = $3
       UNION ALL
       SELECT n.id, n.parent_id
       FROM nodes n
       JOIN ancestors a ON a.parent_id = n.id
       WHERE n.topic_id = $3
     )
     SELECT EXISTS (
       SELECT 1 FROM ancestors WHERE id = $2
     ) AS would_create_cycle`, [proposedParentId, proposedChildId, topicId]);
    return Boolean(result.rows[0]?.would_create_cycle);
}
// -----------------------------------------------------------------------
// SUBGRAPH DEPTH LIMITING & LAZY LOADING TRAVERSAL
// -----------------------------------------------------------------------
async function getTopicSubgraph(topicId, fromNodeId, maxDepth = 2, currentUserId) {
    const topicResult = await db_js_1.db.query('SELECT id, title, root_node_id, fork_count, created_at FROM topics WHERE id = $1', [topicId]);
    if (topicResult.rowCount === 0)
        return null;
    const t = topicResult.rows[0];
    const startNodeId = fromNodeId || t.root_node_id;
    if (!startNodeId)
        throw new sanitizer_js_1.ValidationError('Topic has no root node');
    const nodesResult = await db_js_1.db.query(`WITH RECURSIVE subgraph AS (
       SELECT id, parent_id, author_id, edge_type, pos_x, pos_y, content,
              support_score, contest_score, is_steel, created_at, 0 AS depth
       FROM nodes
       WHERE id = $1 AND topic_id = $3 AND status = 'ACTIVE'

       UNION ALL

       SELECT n.id, n.parent_id, n.author_id, n.edge_type, n.pos_x, n.pos_y, n.content,
              n.support_score, n.contest_score, n.is_steel, n.created_at, sg.depth + 1
       FROM nodes n
       JOIN subgraph sg ON sg.id = n.parent_id
       WHERE sg.depth < $2 AND n.topic_id = $3 AND n.status = 'ACTIVE'
     )
     SELECT sg.*,
            EXISTS (
              SELECT 1 FROM nodes child
              WHERE child.parent_id = sg.id AND child.topic_id = $3 AND child.status = 'ACTIVE'
                AND child.id NOT IN (SELECT id FROM subgraph)
            ) AS has_more_children
     FROM subgraph sg
     ORDER BY sg.pos_y, sg.pos_x`, [startNodeId, maxDepth, topicId]);
    // Fix #10 — scope vote query to current topic's nodes only (not all user votes)
    const userVoteMap = new Map();
    if (currentUserId) {
        const votesResult = await db_js_1.db.query(`SELECT v.node_id, v.vote_type
       FROM votes v
       JOIN nodes n ON n.id = v.node_id
       WHERE v.user_id = $1 AND n.topic_id = $2`, [currentUserId, topicId]);
        for (const v of votesResult.rows) {
            userVoteMap.set(v.node_id, v.vote_type.toLowerCase());
        }
    }
    return {
        id: t.id,
        title: t.title,
        rootNodeId: t.root_node_id,
        forkCount: t.fork_count,
        createdAt: t.created_at.toISOString(),
        nodes: nodesResult.rows.map((row) => rowToNode(row, userVoteMap)),
    };
}
async function getTopic(id, currentUserId) {
    return getTopicSubgraph(id, undefined, 10, currentUserId);
}
// Fix #6 — getAllTopics returns enriched data via single JOIN query
// Fix #9 — supports cursor-based pagination
async function getAllTopics(page = 1, limit = 20) {
    const offset = (page - 1) * limit;
    const [countResult, topicsResult] = await Promise.all([
        db_js_1.db.query('SELECT COUNT(*) AS total FROM topics'),
        db_js_1.db.query(`SELECT
         t.id,
         t.title,
         t.root_node_id,
         t.fork_count,
         t.created_at,
         COUNT(n.id) AS claim_count,
         root_node.content AS root_claim_content
       FROM topics t
       LEFT JOIN nodes n
         ON n.topic_id = t.id AND n.status = 'ACTIVE'
       LEFT JOIN nodes root_node
         ON root_node.id = t.root_node_id
       GROUP BY t.id, root_node.content
       ORDER BY t.created_at DESC
       LIMIT $1 OFFSET $2`, [limit, offset]),
    ]);
    const total = parseInt(countResult.rows[0].total, 10);
    return {
        topics: topicsResult.rows.map((t) => ({
            id: t.id,
            title: t.title,
            rootNodeId: t.root_node_id,
            forkCount: t.fork_count,
            createdAt: t.created_at.toISOString(),
            claimCount: parseInt(t.claim_count, 10),
            rootClaimContent: t.root_claim_content,
        })),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
    };
}
async function createTopic(title, rootClaim, authorId) {
    const user = await getOrCreateUser(authorId);
    const client = await db_js_1.db.connect();
    try {
        await client.query('BEGIN');
        const topicResult = await client.query(`INSERT INTO topics (title, author_id)
       VALUES ($1, $2)
       RETURNING id, created_at`, [title, user.id]);
        const topicId = topicResult.rows[0].id;
        const topicCreatedAt = topicResult.rows[0].created_at;
        const nodeResult = await client.query(`INSERT INTO nodes (topic_id, parent_id, author_id, content, edge_type, pos_x, pos_y, support_score, is_steel)
       VALUES ($1, NULL, $2, $3, 'root', 470, 40, 1, TRUE)
       RETURNING id, created_at`, [topicId, user.id, rootClaim]);
        const rootNodeId = nodeResult.rows[0].id;
        await client.query(`INSERT INTO votes (node_id, user_id, vote_type) VALUES ($1, $2, 'SUPPORT')`, [rootNodeId, user.id]);
        await client.query('UPDATE topics SET root_node_id = $1 WHERE id = $2', [rootNodeId, topicId]);
        await client.query('COMMIT');
        return {
            id: topicId,
            title,
            rootNodeId,
            forkCount: 0,
            createdAt: topicCreatedAt.toISOString(),
            nodes: [
                {
                    id: rootNodeId,
                    parent: null,
                    edgeType: 'root',
                    x: 470,
                    y: 40,
                    content: rootClaim,
                    support: 1,
                    contest: 0,
                    steel: true,
                    userVote: 'support',
                    authorId: user.id,
                    createdAt: nodeResult.rows[0].created_at.toISOString(),
                },
            ],
        };
    }
    catch (err) {
        await client.query('ROLLBACK');
        throw err;
    }
    finally {
        client.release();
    }
}
async function addClaimNode(topicId, parentId, authorId, edgeType, content) {
    const user = await getOrCreateUser(authorId);
    const parentResult = await db_js_1.db.query('SELECT pos_x, pos_y FROM nodes WHERE id = $1 AND topic_id = $2', [parentId, topicId]);
    if (parentResult.rowCount === 0)
        throw new sanitizer_js_1.ValidationError(`Parent node not found: ${parentId}`);
    const parentX = Number(parentResult.rows[0].pos_x);
    const parentY = Number(parentResult.rows[0].pos_y);
    const siblingsResult = await db_js_1.db.query('SELECT COUNT(*) as count FROM nodes WHERE parent_id = $1 AND topic_id = $2', [parentId, topicId]);
    const siblingCount = parseInt(siblingsResult.rows[0].count, 10);
    const newX = parentX + siblingCount * 230;
    const newY = parentY + 260;
    const client = await db_js_1.db.connect();
    try {
        await client.query('BEGIN');
        const insertResult = await client.query(`INSERT INTO nodes (topic_id, parent_id, author_id, content, edge_type, pos_x, pos_y, support_score, contest_score, is_steel)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 1, 0, FALSE)
       RETURNING id, created_at`, [topicId, parentId, user.id, content, edgeType, newX, newY]);
        const newNodeId = insertResult.rows[0].id;
        await client.query(`INSERT INTO votes (node_id, user_id, vote_type) VALUES ($1, $2, 'SUPPORT')`, [newNodeId, user.id]);
        await client.query('COMMIT');
        return {
            id: newNodeId,
            parent: parentId,
            edgeType,
            x: newX,
            y: newY,
            content,
            support: 1,
            contest: 0,
            steel: false,
            userVote: 'support',
            authorId: user.id,
            createdAt: insertResult.rows[0].created_at.toISOString(),
        };
    }
    catch (err) {
        await client.query('ROLLBACK');
        throw err;
    }
    finally {
        client.release();
    }
}
async function voteNode(topicId, nodeId, userId, voteType) {
    const user = await getOrCreateUser(userId);
    const dbVoteType = voteType.toUpperCase();
    const client = await db_js_1.db.connect();
    try {
        await client.query('BEGIN');
        const existingVote = await client.query('SELECT id, vote_type FROM votes WHERE node_id = $1 AND user_id = $2', [nodeId, user.id]);
        let activeUserVote = voteType;
        if (existingVote.rowCount > 0) {
            const currentType = existingVote.rows[0].vote_type;
            if (currentType === dbVoteType) {
                // Toggling same vote off
                await client.query('DELETE FROM votes WHERE id = $1', [existingVote.rows[0].id]);
                activeUserVote = null;
            }
            else {
                await client.query('UPDATE votes SET vote_type = $1 WHERE id = $2', [
                    dbVoteType,
                    existingVote.rows[0].id,
                ]);
            }
        }
        else {
            await client.query('INSERT INTO votes (node_id, user_id, vote_type) VALUES ($1, $2, $3)', [nodeId, user.id, dbVoteType]);
        }
        // Recalculate scores
        const counts = await client.query('SELECT vote_type, COUNT(*) as count FROM votes WHERE node_id = $1 GROUP BY vote_type', [nodeId]);
        let supportScore = 0;
        let contestScore = 0;
        for (const row of counts.rows) {
            if (row.vote_type === 'SUPPORT')
                supportScore = parseInt(row.count, 10);
            if (row.vote_type === 'CONTEST')
                contestScore = parseInt(row.count, 10);
        }
        const nodeInfo = await client.query('SELECT edge_type FROM nodes WHERE id = $1', [nodeId]);
        const isRoot = nodeInfo.rows[0]?.edge_type === 'root';
        const isSteel = isRoot || supportScore > contestScore * 1.8;
        const updated = await client.query(`UPDATE nodes
       SET support_score = $1,
           contest_score = $2,
           is_steel = $3
       WHERE id = $4 AND topic_id = $5
       RETURNING id, parent_id, author_id, edge_type, pos_x, pos_y, content,
                 support_score, contest_score, is_steel, created_at`, [supportScore, contestScore, isSteel, nodeId, topicId]);
        await client.query('COMMIT');
        if (updated.rowCount === 0)
            throw new sanitizer_js_1.ValidationError(`Node not found: ${nodeId}`);
        const node = rowToNode(updated.rows[0]);
        node.userVote = activeUserVote;
        return node;
    }
    catch (err) {
        await client.query('ROLLBACK');
        throw err;
    }
    finally {
        client.release();
    }
}
// Fix #7 — Replace N-query loop with bulk INSERT ... SELECT
async function forkTopic(topicId, authorId) {
    const user = await getOrCreateUser(authorId);
    const original = await getTopic(topicId, user.id);
    if (!original)
        throw new sanitizer_js_1.ValidationError(`Topic not found: ${topicId}`);
    const client = await db_js_1.db.connect();
    try {
        await client.query('BEGIN');
        // Increment fork counter on the original
        await client.query('UPDATE topics SET fork_count = fork_count + 1 WHERE id = $1', [topicId]);
        // Create the new forked topic
        const topicResult = await client.query(`INSERT INTO topics (title, author_id)
       VALUES ($1, $2)
       RETURNING id, created_at`, [`${original.title} (Fork)`, user.id]);
        const newTopicId = topicResult.rows[0].id;
        const newTopicCreatedAt = topicResult.rows[0].created_at;
        // Bulk-copy all nodes in a single INSERT ... SELECT with generated new UUIDs.
        // We store the (old_id, new_id) mapping in a temp table to fix parent_id refs.
        await client.query(`
      CREATE TEMP TABLE _fork_id_map ON COMMIT DROP AS
      SELECT
        n.id AS old_id,
        gen_random_uuid()::text AS new_id
      FROM nodes n
      WHERE n.topic_id = $1
    `, [topicId]);
        // Bulk insert all nodes with new IDs and new topic_id, parent_id still NULL
        await client.query(`
      INSERT INTO nodes (id, topic_id, parent_id, author_id, content, edge_type,
                         pos_x, pos_y, support_score, contest_score, is_steel)
      SELECT
        m.new_id,
        $1,
        NULL,
        $2,
        n.content,
        n.edge_type,
        n.pos_x,
        n.pos_y,
        n.support_score,
        n.contest_score,
        n.is_steel
      FROM nodes n
      JOIN _fork_id_map m ON m.old_id = n.id
      WHERE n.topic_id = $3
    `, [newTopicId, user.id, topicId]);
        // Fix up parent_id references using the id map
        await client.query(`
      UPDATE nodes new_node
      SET parent_id = m_parent.new_id
      FROM nodes orig_node
      JOIN _fork_id_map m_self   ON m_self.old_id   = orig_node.id
      JOIN _fork_id_map m_parent ON m_parent.old_id = orig_node.parent_id
      WHERE new_node.id = m_self.new_id
        AND new_node.topic_id = $1
        AND orig_node.parent_id IS NOT NULL
    `, [newTopicId]);
        // Set the new root_node_id
        await client.query(`
      UPDATE topics
      SET root_node_id = (
        SELECT m.new_id FROM _fork_id_map m WHERE m.old_id = $1
      )
      WHERE id = $2
    `, [original.rootNodeId, newTopicId]);
        await client.query('COMMIT');
        // Reload the forked topic from DB to return accurate state
        const forked = await getTopic(newTopicId, user.id);
        if (!forked)
            throw new Error('Fork creation failed unexpectedly');
        return forked;
    }
    catch (err) {
        await client.query('ROLLBACK');
        throw err;
    }
    finally {
        client.release();
    }
}
