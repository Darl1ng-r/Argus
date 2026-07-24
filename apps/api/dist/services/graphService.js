"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.graphService = void 0;
const uuid_1 = require("uuid");
// In-memory data store for local development & demonstration
class GraphService {
    topics = new Map();
    constructor() {
        this.seedDefaultTopic();
    }
    seedDefaultTopic() {
        const topicId = 'mars-vs-earth';
        const rootNodeId = 'root';
        const defaultNodes = [
            {
                id: 'root',
                parent: null,
                edgeType: 'root',
                x: 610,
                y: 40,
                content: "Humanity should prioritize colonizing Mars over repairing Earth's climate.",
                support: 340,
                contest: 210,
                steel: true,
                createdAt: new Date().toISOString()
            },
            {
                id: 'n1',
                parent: 'root',
                edgeType: 'supports',
                x: 90,
                y: 300,
                content: "A multi-planet species is far less likely to go extinct from any single catastrophe.",
                support: 512,
                contest: 88,
                steel: true,
                createdAt: new Date().toISOString()
            },
            {
                id: 'n2',
                parent: 'root',
                edgeType: 'refutes',
                x: 460,
                y: 300,
                content: "Every dollar spent on Mars is a dollar not spent solving a crisis we already know is solvable.",
                support: 405,
                contest: 140,
                steel: true,
                createdAt: new Date().toISOString()
            },
            {
                id: 'n3',
                parent: 'root',
                edgeType: 'clarifies',
                x: 830,
                y: 300,
                content: "This isn't really either/or — space agencies are under 0.1% of relevant national budgets combined.",
                support: 180,
                contest: 30,
                steel: false,
                createdAt: new Date().toISOString()
            },
            {
                id: 'n4',
                parent: 'root',
                edgeType: 'refutes',
                x: 1160,
                y: 300,
                content: "Fixing Earth doesn't guard against non-climate extinction risks like asteroids or supervolcanoes.",
                support: 260,
                contest: 190,
                steel: false,
                createdAt: new Date().toISOString()
            },
            {
                id: 'n1a',
                parent: 'n1',
                edgeType: 'evidence',
                x: 90,
                y: 560,
                content: "Mars colonies won't be self-sufficient for at least 50 years — this is a bet on unproven timelines.",
                support: 60,
                contest: 240,
                steel: false,
                createdAt: new Date().toISOString()
            },
            {
                id: 'n2a',
                parent: 'n2',
                edgeType: 'supports',
                x: 460,
                y: 560,
                content: "Climate mitigation technology is proven and scaling. Mars life-support technology is not.",
                support: 220,
                contest: 40,
                steel: true,
                createdAt: new Date().toISOString()
            }
        ];
        this.topics.set(topicId, {
            id: topicId,
            title: "Should humanity prioritize colonizing Mars over repairing Earth's climate?",
            rootNodeId,
            forkCount: 0,
            createdAt: new Date().toISOString(),
            nodes: defaultNodes
        });
    }
    getTopic(id) {
        return this.topics.get(id);
    }
    getAllTopics() {
        return Array.from(this.topics.values());
    }
    createTopic(title, rootClaim) {
        const topicId = (0, uuid_1.v4)();
        const rootNodeId = (0, uuid_1.v4)();
        const rootNode = {
            id: rootNodeId,
            parent: null,
            edgeType: 'root',
            x: 610,
            y: 40,
            content: rootClaim,
            support: 1,
            contest: 0,
            steel: true,
            createdAt: new Date().toISOString()
        };
        const topic = {
            id: topicId,
            title,
            rootNodeId,
            forkCount: 0,
            createdAt: new Date().toISOString(),
            nodes: [rootNode]
        };
        this.topics.set(topicId, topic);
        return topic;
    }
    addClaimNode(topicId, parentId, edgeType, content) {
        const topic = this.topics.get(topicId);
        if (!topic) {
            throw new Error(`Topic not found: ${topicId}`);
        }
        const parentNode = topic.nodes.find(n => n.id === parentId);
        if (!parentNode) {
            throw new Error(`Parent claim node not found: ${parentId}`);
        }
        const siblings = topic.nodes.filter(n => n.parent === parentId);
        const newNode = {
            id: 'node-' + (0, uuid_1.v4)().slice(0, 8),
            parent: parentId,
            edgeType,
            x: parentNode.x + siblings.length * 230,
            y: parentNode.y + 260,
            content,
            support: 1,
            contest: 0,
            steel: false,
            createdAt: new Date().toISOString()
        };
        this.recalculateSteelman(newNode);
        topic.nodes.push(newNode);
        return newNode;
    }
    voteNode(topicId, nodeId, voteType) {
        const topic = this.topics.get(topicId);
        if (!topic) {
            throw new Error(`Topic not found: ${topicId}`);
        }
        const node = topic.nodes.find(n => n.id === nodeId);
        if (!node) {
            throw new Error(`Node not found: ${nodeId}`);
        }
        if (voteType === 'support') {
            node.support += 1;
        }
        else {
            node.contest += 1;
        }
        this.recalculateSteelman(node);
        return node;
    }
    forkTopic(topicId) {
        const original = this.topics.get(topicId);
        if (!original) {
            throw new Error(`Topic not found: ${topicId}`);
        }
        original.forkCount += 1;
        const forkedId = `fork-${(0, uuid_1.v4)().slice(0, 8)}`;
        const clonedNodes = JSON.parse(JSON.stringify(original.nodes));
        const forkedTopic = {
            id: forkedId,
            title: `${original.title} (Fork)`,
            rootNodeId: original.rootNodeId,
            forkCount: 0,
            createdAt: new Date().toISOString(),
            nodes: clonedNodes
        };
        this.topics.set(forkedId, forkedTopic);
        return forkedTopic;
    }
    recalculateSteelman(node) {
        if (node.edgeType === 'root') {
            node.steel = true;
            return;
        }
        // Steelman rule: support > contest * 1.8
        node.steel = node.support > node.contest * 1.8;
    }
}
exports.graphService = new GraphService();
