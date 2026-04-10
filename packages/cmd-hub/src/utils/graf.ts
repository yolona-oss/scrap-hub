export class Node {
    value: any
    neighbors: Node[]

    constructor(value: any) {
        this.value = value
        this.neighbors = []
    }

    addNeighbor(node: Node) {
        this.neighbors.push(node)
    }
}

export class Graph {
    nodes: Node[]

    constructor() {
        this.nodes = []
    }

    addNode(value: any) {
        const node = new Node(value)
        this.nodes.push(node)
    }

    addEdge(source: Node, destination: Node) {
        source.addNeighbor(destination)
        destination.addNeighbor(source)
    }
}

export function bfs(startNode: Node) {
    const visited: Set<Node> = new Set()
    const queue: Node[] = []

    visited.add(startNode)
    queue.push(startNode)

    while (queue.length > 0) {
        const currentNode = queue.shift()!
        console.log(currentNode.value)

        for (const neighbor of currentNode.neighbors) {
            if (!visited.has(neighbor)) {
                visited.add(neighbor)
                queue.push(neighbor)
            }
        }
    }
}

export function printGraph(graph: Graph) {
    console.log('Graph:')
    graph.nodes.forEach(node => {
        console.log(`Node: ${node.value.description}`)
        console.log('Neighbors:'); node.neighbors.forEach(neighbor => {
            console.log(`  - ${neighbor.value.description}`)
        })
        console.log('')
    })
}
