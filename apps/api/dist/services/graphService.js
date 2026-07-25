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
async function getOrCreateUser(userId, username) {
    const id = userId || 'system-user-0000-0000-000000000000';
    const name = username || (id === 'system-user-0000-0000-000000000000' ? 'system' : `User_${id.slice(0, 6)}`);
    const email = `${name.toLowerCase()}@argus.local`;
    const existing = await db_js_1.db.query('SELECT id, username, email, reputation FROM users WHERE id = $1', [id]);
    if (existing.rowCount > 0) {
        return existing.rows[0];
    }
    const created = await db_js_1.db.query(`INSERT INTO users (id, username, email, reputation)
     VALUES ($1, $2, $3, 10)
     ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username
     RETURNING id, username, email, reputation`, [id, name, email]);
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
// Executed in PostgreSQL's native engine outside Node.js event loop
// -----------------------------------------------------------------------
async function detectCycle(topicId, proposedParentId, proposedChildId) {
    if (proposedChildId && proposedParentId === proposedChildId) {
        return true;
    }
    if (!proposedChildId) {
        return false;
    }
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
// Uses a PostgreSQL Recursive CTE to fetch nodes up to `maxDepth` hops.
// Checks if leaf nodes in the returned subgraph have additional un-fetched children.
// -----------------------------------------------------------------------
async function getTopicSubgraph(topicId, fromNodeId, maxDepth = 2, currentUserId) {
    const topicResult = await db_js_1.db.query('SELECT id, title, root_node_id, fork_count, created_at FROM topics WHERE id = $1', [topicId]);
    if (topicResult.rowCount === 0)
        return null;
    const t = topicResult.rows[0];
    const startNodeId = fromNodeId || t.root_node_id;
    if (!startNodeId)
        throw new sanitizer_js_1.ValidationError('Topic has no root node');
    // Recursive CTE fetching subgraph up to maxDepth hops
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
    const userVoteMap = new Map();
    if (currentUserId) {
        const votesResult = await db_js_1.db.query('SELECT node_id, vote_type FROM votes WHERE user_id = $1', [currentUserId]);
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
        nodes: nodesResult.rows.map(row => rowToNode(row, userVoteMap)),
    };
}
// Full getTopic fallback
async function getTopic(id, currentUserId) {
    return getTopicSubgraph(id, undefined, 10, currentUserId);
}
// -----------------------------------------------------------------------
// getAllTopics
// -----------------------------------------------------------------------
async function getAllTopics() {
    const result = await db_js_1.db.query('SELECT id, title, root_node_id, fork_count, created_at FROM topics ORDER BY created_at DESC');
    return result.rows.map((t) => ({
        id: t.id,
        title: t.title,
        rootNodeId: t.root_node_id,
        forkCount: t.fork_count,
        createdAt: t.created_at.toISOString(),
    }));
}
// -----------------------------------------------------------------------
// createTopic
// -----------------------------------------------------------------------
async function createTopic(title, rootClaim, authorId) {
    await getOrCreateUser(authorId);
    const client = await db_js_1.db.connect();
    try {
        await client.query('BEGIN');
        const topicResult = await client.query(`INSERT INTO topics (title, author_id)
       VALUES ($1, $2)
       RETURNING id, created_at`, [title, authorId]);
        const topicId = topicResult.rows[0].id;
        const topicCreatedAt = topicResult.rows[0].created_at;
        const nodeResult = await client.query(`INSERT INTO nodes (topic_id, parent_id, author_id, content, edge_type, pos_x, pos_y, support_score, is_steel)
       VALUES ($1, NULL, $2, $3, 'root', 470, 40, 1, TRUE)
       RETURNING id, created_at`, [topicId, authorId, rootClaim]);
        const rootNodeId = nodeResult.rows[0].id;
        await client.query(`INSERT INTO votes (node_id, user_id, vote_type) VALUES ($1, $2, 'SUPPORT')`, [rootNodeId, authorId]);
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
                    authorId,
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
// -----------------------------------------------------------------------
// addClaimNode
// -----------------------------------------------------------------------
async function addClaimNode(topicId, parentId, authorId, edgeType, content) {
    await getOrCreateUser(authorId);
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
       RETURNING id, created_at`, [topicId, parentId, authorId, content, edgeType, newX, newY]);
        const newNodeId = insertResult.rows[0].id;
        await client.query(`INSERT INTO votes (node_id, user_id, vote_type) VALUES ($1, $2, 'SUPPORT')`, [newNodeId, authorId]);
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
            authorId,
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
// -----------------------------------------------------------------------
// voteNode
// -----------------------------------------------------------------------
async function voteNode(topicId, nodeId, userId, voteType) {
    await getOrCreateUser(userId);
    const dbVoteType = voteType.toUpperCase();
    const client = await db_js_1.db.connect();
    try {
        await client.query('BEGIN');
        const existingVote = await client.query('SELECT id, vote_type FROM votes WHERE node_id = $1 AND user_id = $2', [nodeId, userId]);
        let activeUserVote = voteType;
        if (existingVote.rowCount > 0) {
            const currentType = existingVote.rows[0].vote_type;
            if (currentType === dbVoteType) {
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
            await client.query('INSERT INTO votes (node_id, user_id, vote_type) VALUES ($1, $2, $3)', [nodeId, userId, dbVoteType]);
        }
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
// -----------------------------------------------------------------------
// forkTopic
// -----------------------------------------------------------------------
async function forkTopic(topicId, authorId) {
    await getOrCreateUser(authorId);
    const original = await getTopic(topicId, authorId);
    if (!original)
        throw new sanitizer_js_1.ValidationError(`Topic not found: ${topicId}`);
    const client = await db_js_1.db.connect();
    try {
        await client.query('BEGIN');
        await client.query('UPDATE topics SET fork_count = fork_count + 1 WHERE id = $1', [topicId]);
        const topicResult = await client.query(`INSERT INTO topics (title, author_id)
       VALUES ($1, $2)
       RETURNING id, created_at`, [`${original.title} (Fork)`, authorId]);
        const newTopicId = topicResult.rows[0].id;
        const newTopicCreatedAt = topicResult.rows[0].created_at;
        const idMap = new Map();
        const clonedNodes = [];
        for (const node of original.nodes) {
            const nodeResult = await client.query(`INSERT INTO nodes (topic_id, parent_id, author_id, content, edge_type,
                            pos_x, pos_y, support_score, contest_score, is_steel)
         VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, created_at`, [
                newTopicId,
                authorId,
                node.content,
                node.edgeType,
                node.x,
                node.y,
                node.support,
                node.contest,
                node.steel,
            ]);
            const newId = nodeResult.rows[0].id;
            idMap.set(node.id, newId);
            clonedNodes.push({
                ...node,
                id: newId,
                parent: node.parent,
                createdAt: nodeResult.rows[0].created_at.toISOString(),
            });
        }
        for (const node of original.nodes) {
            if (node.parent) {
                const newId = idMap.get(node.id);
                const newParentId = idMap.get(node.parent);
                await client.query('UPDATE nodes SET parent_id = $1 WHERE id = $2', [newParentId, newId]);
            }
        }
        const newRootId = idMap.get(original.rootNodeId);
        await client.query('UPDATE topics SET root_node_id = $1 WHERE id = $2', [newRootId, newTopicId]);
        await client.query('COMMIT');
        return {
            id: newTopicId,
            title: `${original.title} (Fork)`,
            rootNodeId: newRootId,
            forkCount: 0,
            createdAt: newTopicCreatedAt.toISOString(),
            nodes: clonedNodes.map((n) => ({
                ...n,
                id: idMap.get(n.id) ?? n.id,
                parent: n.parent ? idMap.get(n.parent) ?? null : null,
            })),
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
