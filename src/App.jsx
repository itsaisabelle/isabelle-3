import { useMemo, useState } from 'react'
import './App.css'
import diagramText from '../diagramstext.txt?raw'

const CANVAS_WIDTH = 1600
const CANVAS_HEIGHT = 980

const PURPOSE_HINTS = {
  'SEQUENCE DIAGRAM':
    'Shows time-ordered interactions between actors and system components for a concrete scenario.',
  'SYSTEM SEQUENCE DIAGRAM':
    'Focuses on system boundaries by showing external actor inputs and system outputs, while hiding internals.',
  'DOMAIN MODEL DIAGRAM':
    'Captures key conceptual entities and stable business relationships that stay true across features.',
  'DESIGN CLASS DIAGRAM':
    'Translates concepts into implementable classes, methods, responsibilities, and dependencies.',
  'USE CASE DIAGRAM':
    'Summarizes functional goals from the user perspective and clarifies actor-to-system capabilities.',
}

function normalizeId(id) {
  return id.toUpperCase().trim()
}

function parseNodeLabel(label) {
  const clean = label.trim()
  const match = clean.match(/^(.*?)\s*(\([^()]+\))\s*$/)
  if (match) {
    return {
      title: match[1].trim(),
      subtitle: match[2].trim(),
    }
  }

  return {
    title: clean,
    subtitle: '',
  }
}

function extractSequenceNumber(id) {
  const match = id.match(/(\d+)/)
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}

function isConstraintRelevant(constraint, entityId) {
  if (constraint.includes(entityId)) {
    return true
  }

  const rangeRegex = /([A-Z]+)(\d+)\s*-\s*([A-Z]+)?(\d+)/g
  let rangeMatch = rangeRegex.exec(constraint)

  while (rangeMatch) {
    const startPrefix = rangeMatch[1]
    const startNum = Number(rangeMatch[2])
    const endPrefix = rangeMatch[3] || startPrefix
    const endNum = Number(rangeMatch[4])

    const idMatch = entityId.match(/^([A-Z]+)(\d+)$/)
    if (idMatch) {
      const idPrefix = idMatch[1]
      const idNum = Number(idMatch[2])
      if (idPrefix === startPrefix && idPrefix === endPrefix && idNum >= startNum && idNum <= endNum) {
        return true
      }
    }

    rangeMatch = rangeRegex.exec(constraint)
  }

  return false
}

function parseDiagrams(text) {
  const cleanText = text.replace(/\r/g, '')
  const sections = []
  const headerRegex = /^===\s*(.+?)\s*===\s*$/gm
  let match = headerRegex.exec(cleanText)

  while (match) {
    sections.push({
      title: match[1].trim(),
      headerStart: match.index,
      headerEnd: headerRegex.lastIndex,
    })
    match = headerRegex.exec(cleanText)
  }

  return sections.map((section, index) => {
    const nextHeaderStart = index + 1 < sections.length ? sections[index + 1].headerStart : cleanText.length
    const body = cleanText.slice(section.headerEnd, nextHeaderStart).trim()
    const lines = body.split('\n')

    const nodes = []
    const links = []
    const constraints = []

    let currentNode = null

    lines.forEach((rawLine) => {
      const line = rawLine.trim()
      if (!line) {
        return
      }

      const nodeMatch = line.match(/^NODE\s+\[([^\]]+)\]\s+(.+)$/)
      if (nodeMatch) {
        const parsedNodeLabel = parseNodeLabel(nodeMatch[2])
        currentNode = {
          id: normalizeId(nodeMatch[1]),
          label: nodeMatch[2].trim(),
          title: parsedNodeLabel.title,
          subtitle: parsedNodeLabel.subtitle,
          raw: line,
          details: [],
        }
        nodes.push(currentNode)
        return
      }

      const linkMatch = line.match(/^LINK\s+\[([^\]]+)\]\s+(.+)$/)
      if (linkMatch) {
        const descriptor = linkMatch[2].trim()
        const parts = descriptor.split('|').map((part) => part.trim())
        const arrow = parts[0].match(/([A-Za-z0-9_]+)\s*->\s*([A-Za-z0-9_]+)/)

        links.push({
          id: normalizeId(linkMatch[1]),
          source: arrow ? normalizeId(arrow[1]) : null,
          target: arrow ? normalizeId(arrow[2]) : null,
          relationType: parts[1] || 'RELATION',
          relationLabel: parts[2] || parts[0],
          notes: parts.slice(3).join(' | '),
          raw: line,
        })

        currentNode = null
        return
      }

      const constraintMatch = line.match(/^CONSTRAINT:\s+(.+)$/)
      if (constraintMatch) {
        constraints.push(constraintMatch[1].trim())
        currentNode = null
        return
      }

      const detailMatch = line.match(/^(ATTRIBUTE|ATTRIBUTES|METHOD|NOTE):\s+(.+)$/)
      if (detailMatch && currentNode) {
        currentNode.details.push(`${detailMatch[1]}: ${detailMatch[2]}`)
      }
    })

    const enrichedNodes = nodes.map((node) => {
      const relatedConstraints = constraints.filter((constraint) => isConstraintRelevant(constraint, node.id))
      const detailsText = node.details.length > 0 ? `Key details: ${node.details.join(' | ')}` : 'This node is a key participant in the scenario.'
      const justification =
        relatedConstraints.length > 0
          ? `${detailsText} Constraint context: ${relatedConstraints.join(' | ')}`
          : detailsText

      return {
        ...node,
        justification,
      }
    })

    const enrichedLinks = links
      .sort((a, b) => extractSequenceNumber(a.id) - extractSequenceNumber(b.id))
      .map((link) => {
        const relatedConstraints = constraints.filter((constraint) => isConstraintRelevant(constraint, link.id))
        const relationSummary = `${link.relationType}: ${link.relationLabel}`
        const notesSummary = link.notes ? ` Notes: ${link.notes}` : ''
        const constraintSummary = relatedConstraints.length > 0 ? ` Constraint context: ${relatedConstraints.join(' | ')}` : ''

        return {
          ...link,
          justification: `${relationSummary}.${notesSummary}${constraintSummary}`.trim(),
        }
      })

    return {
      title: section.title,
      nodes: enrichedNodes,
      links: enrichedLinks,
      constraints,
    }
  })
}

function getNodePositions(nodes, width, height) {
  if (nodes.length === 0) {
    return {}
  }

  const positions = {}
  const columns = Math.max(2, Math.ceil(Math.sqrt(nodes.length)))
  const rows = Math.ceil(nodes.length / columns)
  const horizontalGap = width / (columns + 1)
  const verticalGap = height / (rows + 1)

  nodes.forEach((node, index) => {
    const row = Math.floor(index / columns)
    const col = index % columns
    positions[node.id] = {
      x: horizontalGap * (col + 1),
      y: verticalGap * (row + 1),
    }
  })

  return positions
}

function getTeachingMeta(diagram, index, diagrams) {
  const purposeKey = Object.keys(PURPOSE_HINTS).find((key) => diagram.title.includes(key))
  const purpose = purposeKey ? PURPOSE_HINTS[purposeKey] : 'Explains a focused model of system behavior, structure, or interaction.'

  const process =
    diagram.links.length > 0
      ? [
          'Identify the entities shown in this view and their role.',
          'Trace links in ID order to follow flow or dependency.',
          'Use constraints to interpret when links are valid or restricted.',
        ]
      : ['Read node details first, then interpret constraints and context notes.']

  const previous = index > 0 ? diagrams[index - 1].title : null
  const next = index + 1 < diagrams.length ? diagrams[index + 1].title : null

  const connectionText =
    index === 0
      ? 'This operational scenario motivates system-level and design-level modeling in later tabs.'
      : index === diagrams.length - 1
        ? 'This view consolidates behaviors validated by earlier sequence, design, and domain representations.'
        : 'This tab bridges concrete behavior with progressively more abstract or implementation-focused views.'

  return {
    purpose,
    process,
    connectionText,
    dropdownText:
      'Study tip: click one node, then every connected relationship, and explain how each constraint changes allowed behavior.',
    infoText:
      'Use this workspace to compare how the same scenario appears as interactions, responsibilities, domain concepts, and user goals.',
    previous,
    next,
  }
}

function getDiagramKind(diagram, index) {
  const title = diagram.title.toUpperCase()
  if (title.includes('SYSTEM SEQUENCE')) {
    return 'system-sequence'
  }
  if (title.includes('SEQUENCE DIAGRAM')) {
    return 'sequence'
  }
  if (title.includes('DOMAIN MODEL')) {
    return 'domain-model'
  }
  if (title.includes('DESIGN CLASS')) {
    return 'design-class'
  }
  if (title.includes('USE CASE')) {
    return 'use-case'
  }

  const orderedKinds = ['sequence', 'system-sequence', 'domain-model', 'design-class', 'use-case']
  return orderedKinds[index] || 'sequence'
}

function getGridPositions(nodes, width, topPadding = 120, cols = 3, rowGap = 220) {
  const map = {}
  const colGap = width / (cols + 1)
  nodes.forEach((node, index) => {
    const row = Math.floor(index / cols)
    const col = index % cols
    map[node.id] = {
      x: colGap * (col + 1),
      y: topPadding + row * rowGap,
    }
  })
  return map
}

function isSystemNode(node) {
  const sub = (node.subtitle || '').toLowerCase()
  const label = (node.label || '').toLowerCase()
  return sub.includes('system') || label.includes('system') || label.includes('black box')
}

function renderSequenceDiagram(diagram, selectedEntity, onSelect, systemView = false) {
  const lifelineTop = 120
  const messageStart = 218
  const messageStep = systemView ? 44 : 40
  const colGap = CANVAS_WIDTH / (diagram.nodes.length + 1)
  const positions = {}

  diagram.nodes.forEach((node, index) => {
    positions[node.id] = {
      x: colGap * (index + 1),
      y: lifelineTop,
    }
  })

  const systemNodeIndices = systemView
    ? diagram.nodes
        .map((node, i) => (isSystemNode(node) ? i : -1))
        .filter((i) => i >= 0)
    : []
  const hasSystemBlock =
    systemView && systemNodeIndices.length > 0
  const systemLeft = hasSystemBlock
    ? positions[diagram.nodes[systemNodeIndices[0]].id].x - 140
    : 0
  const systemRight = hasSystemBlock
    ? positions[diagram.nodes[systemNodeIndices[systemNodeIndices.length - 1]].id].x + 140
    : 0

  const svgClass = 'diagram-svg' + (systemView ? ' system-sequence' : ' sequence-diagram')

  const bottomPadding = 100
  const contentHeight = messageStart + diagram.links.length * messageStep + bottomPadding
  const seqHeight = Math.max(CANVAS_HEIGHT, contentHeight)

  return (
    <svg viewBox={`0 0 ${CANVAS_WIDTH} ${seqHeight}`} className={svgClass} role="img" aria-label={diagram.title}>
      <defs>
        <marker id="arrow-seq" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" className="arrowhead-shape" />
        </marker>
      </defs>

      {hasSystemBlock && (
        <rect
          x={systemLeft}
          y={lifelineTop - 58}
          width={systemRight - systemLeft}
          height={seqHeight - (lifelineTop - 58) - 40}
          rx="14"
          className="system-boundary"
          aria-hidden="true"
        />
      )}

      {diagram.nodes.map((node) => {
        const pos = positions[node.id]
        const isSelected = selectedEntity?.kind === 'node' && selectedEntity.id === node.id
        const isSystem = systemView && isSystemNode(node)
        const nodeClass = isSelected
          ? 'diagram-node sequence-node selected'
          : isSystem
            ? 'diagram-node sequence-node sequence-node-system'
            : 'diagram-node sequence-node'
        return (
          <g key={node.id} className="node-group" onClick={() => onSelect({ kind: 'node', entity: node })}>
            <rect
              x={pos.x - 118}
              y={pos.y - 46}
              width="236"
              height="64"
              rx="12"
              className={nodeClass}
            />
            <text x={pos.x} y={pos.y - 18} className="node-id">
              {node.title}
            </text>
            <text x={pos.x} y={pos.y + 2} className="node-label">
              {node.subtitle || node.id}
            </text>
            <line x1={pos.x} y1={lifelineTop + 18} x2={pos.x} y2={seqHeight - 50} className="lifeline" />
          </g>
        )
      })}

      {diagram.links.map((link, index) => {
        const source = positions[link.source]
        const target = positions[link.target]
        if (!source || !target) {
          return null
        }

        const y = messageStart + index * messageStep
        const isSelected = selectedEntity?.kind === 'link' && selectedEntity.id === link.id
        const centerX = (source.x + target.x) / 2
        const isReturn = (link.relationType || '').toUpperCase() === 'RETURN'
        const labelText = link.relationLabel || link.id
        const labelWidth = Math.min(420, Math.max(200, labelText.length * 8))
        const labelHeight = 24

        return (
          <g key={link.id} className="link-group" onClick={() => onSelect({ kind: 'link', entity: link })}>
            <line
              x1={source.x}
              y1={y}
              x2={target.x}
              y2={y}
              className={isSelected ? 'diagram-link selected' : 'diagram-link'}
              markerEnd="url(#arrow-seq)"
              strokeDasharray={isReturn ? '7 6' : 'none'}
            />
            <line x1={source.x} y1={y} x2={target.x} y2={y} className="link-hitbox" />
            <rect
              x={centerX - labelWidth / 2}
              y={y - labelHeight / 2 - 2}
              width={labelWidth}
              height={labelHeight}
              rx="10"
              className={isSelected ? 'link-label-bg selected' : 'link-label-bg'}
            />
            <text x={centerX} y={y + 5} className="link-label-text">
              {labelText}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function renderDomainModelDiagram(diagram, selectedEntity, onSelect) {
  const NODE_WIDTH = 264
  const NODE_HEIGHT = 154
  const NODE_HALF_WIDTH = NODE_WIDTH / 2
  const NODE_HALF_HEIGHT = NODE_HEIGHT / 2

  const customPositions = {
    C1: { x: 220, y: 180 },
    C2: { x: 800, y: 180 },
    C3: { x: 1380, y: 180 },
    C4: { x: 420, y: 500 },
    C5: { x: 800, y: 500 },
    C6: { x: 1380, y: 500 },
    C7: { x: 500, y: 820 },
    C8: { x: 1100, y: 820 },
  }

  const fallbackPositions = getGridPositions(diagram.nodes, CANVAS_WIDTH, 140, 3, 250)
  const positions = {}

  diagram.nodes.forEach((node) => {
    positions[node.id] = customPositions[node.id] || fallbackPositions[node.id]
  })

  const cleanRelationshipLabel = (label) => label.replace(/^"|"$/g, '').trim()

  const parseMultiplicity = (notes, classId) => {
    if (!notes) {
      return ''
    }
    const escapedId = classId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`${escapedId}\\s+multiplicity:\\s*([^|]+)`, 'i')
    const match = notes.match(regex)
    return match ? match[1].trim() : ''
  }

  const domainLinkRouting = {
    R1: {
      points: [{ x: 150, y: 257 }, { x: 150, y: 390 }, { x: 320, y: 390 }, { x: 320, y: 423 }],
      label: { x: 234, y: 382 },
      sourceMultiplicityPos: { x: 132, y: 276 },
      targetMultiplicityPos: { x: 334, y: 414 },
    },
    R2: { points: [{ x: 450, y: 423 }, { x: 450, y: 300 }, { x: 800, y: 300 }, { x: 800, y: 257 }] },
    R3: {
      points: [{ x: 220, y: 257 }, { x: 220, y: 620 }, { x: 860, y: 620 }, { x: 860, y: 577 }],
      label: { x: 548, y: 612 },
      sourceMultiplicityPos: { x: 202, y: 276 },
      targetMultiplicityPos: { x: 874, y: 568 },
    },
    R4: { points: [{ x: 800, y: 257 }, { x: 800, y: 423 }] },
    R5: { points: [{ x: 932, y: 180 }, { x: 1248, y: 180 }] },
    R6: {
      points: [{ x: 340, y: 257 }, { x: 580, y: 257 }, { x: 580, y: 700 }, { x: 1360, y: 700 }, { x: 1360, y: 960 }, { x: 1460, y: 960 }, { x: 1460, y: 577 }],
      label: { x: 972, y: 692 },
      sourceMultiplicityPos: { x: 322, y: 276 },
      targetMultiplicityPos: { x: 1474, y: 568 },
    },
    R7: { points: [{ x: 1380, y: 257 }, { x: 1380, y: 423 }] },
    R8: {
      points: [{ x: 88, y: 180 }, { x: 60, y: 180 }, { x: 60, y: 820 }, { x: 368, y: 820 }],
      label: { x: 74, y: 496 },
      sourceMultiplicityPos: { x: 44, y: 168 },
      targetMultiplicityPos: { x: 382, y: 810 },
    },
    R9: {
      points: [{ x: 520, y: 743 }, { x: 520, y: 660 }, { x: 910, y: 660 }, { x: 910, y: 340 }, { x: 820, y: 340 }, { x: 820, y: 257 }],
      label: { x: 710, y: 652 },
      sourceMultiplicityPos: { x: 534, y: 734 },
      targetMultiplicityPos: { x: 834, y: 276 },
    },
    R10: {
      points: [{ x: 280, y: 257 }, { x: 260, y: 257 }, { x: 260, y: 920 }, { x: 920, y: 920 }, { x: 920, y: 840 }, { x: 968, y: 840 }],
      label: { x: 592, y: 912 },
      sourceMultiplicityPos: { x: 262, y: 276 },
      targetMultiplicityPos: { x: 982, y: 830 },
    },
    R11: {
      points: [{ x: 840, y: 257 }, { x: 840, y: 300 }, { x: 952, y: 300 }, { x: 952, y: 690 }, { x: 1100, y: 690 }, { x: 1100, y: 743 }],
      label: { x: 968, y: 496 },
      sourceMultiplicityPos: { x: 854, y: 276 },
      targetMultiplicityPos: { x: 1114, y: 734 },
    },
    R12: {
      points: [{ x: 932, y: 500 }, { x: 944, y: 500 }, { x: 944, y: 820 }, { x: 968, y: 820 }],
      label: { x: 958, y: 654 },
    },
  }

  const inferBorderSide = (position, point) => {
    const left = position.x - NODE_HALF_WIDTH
    const right = position.x + NODE_HALF_WIDTH
    const top = position.y - NODE_HALF_HEIGHT
    const bottom = position.y + NODE_HALF_HEIGHT

    if (Math.abs(point.x - left) <= 1) {
      return 'left'
    }
    if (Math.abs(point.x - right) <= 1) {
      return 'right'
    }
    if (Math.abs(point.y - top) <= 1) {
      return 'top'
    }
    return 'bottom'
  }

  const getLabelPoint = (points) => {
    if (points.length < 2) {
      return points[0] || { x: 0, y: 0 }
    }

    let longest = { a: points[0], b: points[1], length: 0 }

    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i]
      const b = points[i + 1]
      const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
      if (length > longest.length) {
        longest = { a, b, length }
      }
    }

    return {
      x: (longest.a.x + longest.b.x) / 2,
      y: (longest.a.y + longest.b.y) / 2,
    }
  }

  const getMultiplicityPosition = (anchor, side, target = false) => {
    const inward = target ? -1 : 1
    if (side === 'top' || side === 'bottom') {
      return {
        x: anchor.x + 14,
        y: anchor.y + (side === 'top' ? -14 : 18) * inward,
      }
    }
    return {
      x: anchor.x + (side === 'left' ? -18 : 18) * inward,
      y: anchor.y - 10,
    }
  }

  const pathFromPoints = (points) => {
    if (!points || points.length === 0) {
      return ''
    }
    return points.reduce((acc, point, index) => {
      if (index === 0) {
        return `M ${point.x} ${point.y}`
      }
      return `${acc} L ${point.x} ${point.y}`
    }, '')
  }

  return (
    <svg viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT + 360}`} className="diagram-svg" role="img" aria-label={diagram.title}>

      {diagram.links.map((link) => {
        const source = positions[link.source]
        const target = positions[link.target]
        if (!source || !target) {
          return null
        }

        const route = domainLinkRouting[link.id]
        const points = route?.points || []
        const path = pathFromPoints(points)

        const isSelected = selectedEntity?.kind === 'link' && selectedEntity.id === link.id
        const labelPoint = route?.label || getLabelPoint(points)
        const labelX = labelPoint.x
        const labelY = labelPoint.y
        const label = cleanRelationshipLabel(link.relationLabel)
        const sourceMultiplicity = parseMultiplicity(link.notes, link.source)
        const targetMultiplicity = parseMultiplicity(link.notes, link.target)
        const sourceSide = inferBorderSide(source, points[0])
        const targetSide = inferBorderSide(target, points[points.length - 1])
        const firstPoint = points[0]
        const lastPoint = points[points.length - 1]
        const sourceMultiplicityPos = route?.sourceMultiplicityPos || getMultiplicityPosition(firstPoint, sourceSide)
        const targetMultiplicityPos = route?.targetMultiplicityPos || getMultiplicityPosition(lastPoint, targetSide, true)
        const isDashed = /DASHED/i.test(link.notes)

        return (
          <g key={link.id} className="link-group" onClick={() => onSelect({ kind: 'link', entity: link })}>
            <path
              d={path}
              className={isSelected ? 'diagram-link selected' : 'diagram-link'}
              strokeDasharray={isDashed ? '7 6' : 'none'}
            />
            <path d={path} className="link-hitbox" />
            <text x={labelX} y={labelY + 5} className={isSelected ? 'link-label-text domain-link-label selected' : 'link-label-text domain-link-label'}>
              {label}
            </text>
            {sourceMultiplicity ? (
              <text x={sourceMultiplicityPos?.x ?? firstPoint.x - 12} y={sourceMultiplicityPos?.y ?? firstPoint.y - 10} className="domain-multiplicity">
                {sourceMultiplicity}
              </text>
            ) : null}
            {targetMultiplicity ? (
              <text x={targetMultiplicityPos?.x ?? lastPoint.x + 12} y={targetMultiplicityPos?.y ?? lastPoint.y - 10} className="domain-multiplicity">
                {targetMultiplicity}
              </text>
            ) : null}
          </g>
        )
      })}

      {diagram.nodes.map((node) => {
        const pos = positions[node.id]
        const isSelected = selectedEntity?.kind === 'node' && selectedEntity.id === node.id
        const details = node.details.slice(0, 4)
        return (
          <g key={node.id} className="node-group" onClick={() => onSelect({ kind: 'node', entity: node })}>
            <rect
              x={pos.x - NODE_HALF_WIDTH}
              y={pos.y - NODE_HALF_HEIGHT}
              width={NODE_WIDTH}
              height={NODE_HEIGHT}
              rx="12"
              className={isSelected ? 'diagram-node class-node selected' : 'diagram-node class-node'}
            />
            <line
              x1={pos.x - NODE_HALF_WIDTH}
              y1={pos.y - NODE_HALF_HEIGHT + 36}
              x2={pos.x + NODE_HALF_WIDTH}
              y2={pos.y - NODE_HALF_HEIGHT + 36}
              className="class-divider"
            />
            <text x={pos.x} y={pos.y - 48} className="node-id">
              {node.title}
            </text>
            <text x={pos.x} y={pos.y - 16} className="node-label">
              {node.id}
            </text>
            {details.map((detail, index) => (
              <text key={detail} x={pos.x - 118} y={pos.y + 12 + index * 18} className="class-detail">
                {detail.replace(/^ATTRIBUTE:\s*/i, '').slice(0, 36)}
              </text>
            ))}
          </g>
        )
      })}

      <g className="domain-constraint-group">
        <rect x="172" y="1046" width="1256" height="118" rx="12" className="domain-constraint-box" />
        <text x="800" y="1092" className="domain-constraint-text">
          Constraint: a Student may hold PresidentRole in at most one Organization at a time.
        </text>
        <text x="800" y="1126" className="domain-constraint-text">
          An Event cannot exceed maxCapacity active RSVPRegistrations.
        </text>
      </g>
    </svg>
  )
}

function computeOrthoLanes(links, getPos) {
  const BAND = 20
  const items = links.map((link) => {
    const s = getPos(link.source)
    const t = getPos(link.target)
    if (!s || !t) return null
    return {
      id: link.id,
      baseMidX: (s.x + t.x) / 2,
      minY: Math.min(s.y, t.y),
      maxY: Math.max(s.y, t.y),
      offset: 0,
    }
  })

  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < items.length; i++) {
      if (!items[i]) continue
      for (let j = i + 1; j < items.length; j++) {
        if (!items[j]) continue
        const laneI = items[i].baseMidX + items[i].offset
        const laneJ = items[j].baseMidX + items[j].offset
        if (Math.abs(laneI - laneJ) >= BAND) continue
        const yOverlap = items[i].minY < items[j].maxY && items[j].minY < items[i].maxY
        if (!yOverlap) continue
        items[j].offset += BAND
      }
    }
  }

  const result = {}
  links.forEach((link, idx) => {
    result[link.id] = items[idx]?.offset ?? 0
  })
  return result
}

function buildOrthoPath(sx, sy, tx, ty, laneX) {
  return `M ${sx} ${sy} L ${laneX} ${sy} L ${laneX} ${ty} L ${tx} ${ty}`
}

function cleanRelationshipLabel(label) {
  return (label || '').replace(/^"|"$/g, '').trim()
}

function parseLinkMultiplicity(notes) {
  if (!notes) {
    return ''
  }

  const match = notes.match(/multiplicity:\s*([^|]+)/i)
  return match ? match[1].trim() : ''
}

function parseLinkMultiplicityParts(notes) {
  const multiplicity = parseLinkMultiplicity(notes)
  if (!multiplicity) {
    return { source: '', target: '' }
  }

  const parts = multiplicity.split(/\s*->\s*/)
  return {
    source: parts[0]?.trim() || '',
    target: parts[1]?.trim() || '',
  }
}

function getOrthoInlineLabelPosition(sx, sy, tx, ty, laneX) {
  const horizontalSegments = [
    { x1: sx, x2: laneX, y: sy, length: Math.abs(laneX - sx) },
    { x1: laneX, x2: tx, y: ty, length: Math.abs(tx - laneX) },
  ].sort((left, right) => right.length - left.length)

  const best = horizontalSegments[0]
  if (best.length > 0) {
    return {
      x: (best.x1 + best.x2) / 2,
      y: best.y,
    }
  }

  return {
    x: laneX,
    y: (sy + ty) / 2,
  }
}

function getDesignClassOrthoGeometry(source, target, laneX) {
  const NODE_HALF_WIDTH = 150
  const sourceDirection = Math.sign(laneX - source.x) || Math.sign(target.x - source.x) || 1
  const targetDirection = Math.sign(laneX - target.x) || Math.sign(source.x - target.x) || -1
  const sourceX = source.x + sourceDirection * NODE_HALF_WIDTH
  const targetX = target.x + targetDirection * NODE_HALF_WIDTH

  return {
    start: { x: sourceX, y: source.y },
    end: { x: targetX, y: target.y },
    labelPoint: getOrthoInlineLabelPosition(sourceX, source.y, targetX, target.y, laneX),
    d: buildOrthoPath(sourceX, source.y, targetX, target.y, laneX),
  }
}

function getActorAnchor(actorPos, targetPos) {
  const anchors = [
    { x: actorPos.x,      y: actorPos.y - 52 }, // top  (above head)
    { x: actorPos.x + 20, y: actorPos.y      }, // right (arm tip)
    { x: actorPos.x,      y: actorPos.y + 50 }, // bottom (feet)
    { x: actorPos.x - 20, y: actorPos.y      }, // left  (arm tip)
  ]
  const deg = Math.atan2(targetPos.y - actorPos.y, targetPos.x - actorPos.x) * 180 / Math.PI
  if (deg >= -45 && deg < 45)   return anchors[1]
  if (deg >= 45  && deg < 135)  return anchors[2]
  if (deg >= -135 && deg < -45) return anchors[0]
  return anchors[3]
}

function getEllipseAnchor(center, target, rx = 128, ry = 44) {
  const dx = target.x - center.x
  const dy = target.y - center.y
  const scale = 1 / Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) || 1)

  return {
    x: center.x + dx * scale,
    y: center.y + dy * scale,
  }
}

function getActorRoleLabel(node) {
  const clean = (node.subtitle || '')
    .replace(/[()]/g, '')
    .replace(/^Actor\s*-\s*/i, '')
    .replace(/^External Actor\s*-\s*/i, '')
    .split(',')[0]
    .split('/')[0]
    .trim()

  return clean || node.id
}

function getUseCaseDisplayLabel(node) {
  const subtitle = (node.subtitle || '').replace(/^\(|\)$/g, '').trim()
  if (!subtitle) {
    return node.title
  }

  const compactSubtitle = subtitle.replace(/via external authentication/i, 'external auth')
  return `${node.title} (${compactSubtitle})`
}

function renderDesignClassDiagram(diagram, selectedEntity, onSelect) {
  const NODE_HALF_WIDTH = 150
  const NODE_HALF_HEIGHT = 95
  const customPositions = {
    D1: { x: 760, y: 170 },
    D4: { x: 260, y: 560 },
    D2: { x: 1220, y: 560 },
    D5: { x: 260, y: 1050 },
    D3: { x: 1220, y: 1050 },
  }
  const fallbackPositions = getGridPositions(diagram.nodes, CANVAS_WIDTH, 140, 2, 340)
  const positions = {}

  diagram.nodes.forEach((node) => {
    positions[node.id] = customPositions[node.id] || fallbackPositions[node.id]
  })

  const routePoint = (nodeId, side, offset = 0) => {
    const pos = positions[nodeId]
    if (!pos) {
      return { x: 0, y: 0 }
    }
    if (side === 'top') {
      return { x: pos.x + offset, y: pos.y - NODE_HALF_HEIGHT }
    }
    if (side === 'bottom') {
      return { x: pos.x + offset, y: pos.y + NODE_HALF_HEIGHT }
    }
    if (side === 'left') {
      return { x: pos.x - NODE_HALF_WIDTH, y: pos.y + offset }
    }
    return { x: pos.x + NODE_HALF_WIDTH, y: pos.y + offset }
  }

  const designLinkRouting = {
    A1: {
      points: [routePoint('D1', 'right', 24), routePoint('D2', 'top', -96)],
      label: { x: 1035, y: 455 },
      sourceMultiplicityPos: { x: 890, y: 300 },
      targetMultiplicityPos: { x: 1088, y: 418 },
    },
    A2: {
      points: [routePoint('D1', 'left', 24), routePoint('D4', 'top', 102)],
      label: { x: 520, y: 430 },
    },
    A3: {
      points: [routePoint('D1', 'bottom', 120), { x: 1110, y: 700 }, routePoint('D3', 'top', -66)],
      label: { x: 1094, y: 740 },
    },
    A4: {
      points: [routePoint('D1', 'bottom', 8), routePoint('D6', 'top', -28)],
      label: { x: 724, y: 635 },
    },
    A5: {
      points: [routePoint('D4', 'bottom', 0), routePoint('D5', 'top', 0)],
      label: { x: 166, y: 820 },
      sourceMultiplicityPos: { x: 286, y: 785 },
      targetMultiplicityPos: { x: 286, y: 930 },
    },
    A6: {
      points: [routePoint('D4', 'right', -34), routePoint('D2', 'left', 14)],
      label: { x: 760, y: 600 },
      sourceMultiplicityPos: { x: 442, y: 575 },
      targetMultiplicityPos: { x: 1068, y: 615 },
    },
    A7: {
      points: [routePoint('D2', 'bottom', 0), routePoint('D3', 'top', 0)],
      label: { x: 1294, y: 846 },
      sourceMultiplicityPos: { x: 1278, y: 785 },
      targetMultiplicityPos: { x: 1278, y: 930 },
    },
    A8: {
      points: [routePoint('D6', 'right', 14), routePoint('D3', 'left', 14)],
      label: { x: 1010, y: 1006 },
      sourceMultiplicityPos: { x: 922, y: 994 },
      targetMultiplicityPos: { x: 1068, y: 1012 },
    },
    A9: {
      points: [routePoint('D5', 'right', 0), routePoint('D6', 'left', 10)],
      label: { x: 500, y: 1018 },
      sourceMultiplicityPos: { x: 424, y: 1038 },
      targetMultiplicityPos: { x: 608, y: 1010 },
    },
  }

  const pathFromPoints = (points) => {
    if (!points || points.length === 0) {
      return ''
    }
    return points.reduce((acc, point, index) => {
      if (index === 0) {
        return `M ${point.x} ${point.y}`
      }
      return `${acc} L ${point.x} ${point.y}`
    }, '')
  }

  return (
    <svg viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT + 540}`} className="diagram-svg" role="img" aria-label={diagram.title}>
      <defs>
        <marker id="arrow-design" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" className="arrowhead-shape" />
        </marker>
      </defs>

      {diagram.links.map((link) => {
        const source = positions[link.source]
        const target = positions[link.target]
        if (!source || !target) {
          return null
        }
        const isSelected = selectedEntity?.kind === 'link' && selectedEntity.id === link.id
        const isDependency = link.relationType.toUpperCase().includes('DEPENDENCY')
        const route = designLinkRouting[link.id]
        const points = route?.points || [source, target]
        const d = pathFromPoints(points)
        const label = cleanRelationshipLabel(link.relationLabel) || link.relationType
        const multiplicity = parseLinkMultiplicityParts(link.notes)
        const labelPoint = route?.label || {
          x: (points[0].x + points[points.length - 1].x) / 2,
          y: (points[0].y + points[points.length - 1].y) / 2,
        }
        return (
          <g key={`${link.id}-line`} className="link-group" onClick={() => onSelect({ kind: 'link', entity: link })}>
            <path
              d={d}
              className={isSelected ? 'diagram-link selected' : 'diagram-link'}
              markerEnd="url(#arrow-design)"
              strokeDasharray={isDependency ? '8 6' : 'none'}
            />
            <path d={d} className="link-hitbox" />
            {multiplicity.source ? (
              <text x={route?.sourceMultiplicityPos?.x ?? points[0].x + 18} y={route?.sourceMultiplicityPos?.y ?? points[0].y - 12} className={isSelected ? 'link-label-text design-link-multiplicity selected' : 'link-label-text design-link-multiplicity'}>
                {multiplicity.source}
              </text>
            ) : null}
            {multiplicity.target ? (
              <text x={route?.targetMultiplicityPos?.x ?? points[points.length - 1].x - 18} y={route?.targetMultiplicityPos?.y ?? points[points.length - 1].y - 12} className={isSelected ? 'link-label-text design-link-multiplicity selected' : 'link-label-text design-link-multiplicity'}>
                {multiplicity.target}
              </text>
            ) : null}
            <text x={labelPoint.x} y={labelPoint.y + 5} className={isSelected ? 'link-label-text design-link-label selected' : 'link-label-text design-link-label'}>
              {label}
            </text>
          </g>
        )
      })}

      {diagram.nodes.map((node) => {
        const pos = positions[node.id]
        const isSelected = selectedEntity?.kind === 'node' && selectedEntity.id === node.id
        const attributes = node.details.filter((item) => item.startsWith('ATTRIBUTE') || item.startsWith('ATTRIBUTES')).slice(0, 3)
        const methods = node.details.filter((item) => item.startsWith('METHOD')).slice(0, 3)
        return (
          <g key={node.id} className="node-group" onClick={() => onSelect({ kind: 'node', entity: node })}>
            <rect x={pos.x - NODE_HALF_WIDTH} y={pos.y - NODE_HALF_HEIGHT} width="300" height="190" rx="10" className={isSelected ? 'diagram-node class-node selected' : 'diagram-node class-node'} />
            <line x1={pos.x - NODE_HALF_WIDTH} y1={pos.y - 56} x2={pos.x + NODE_HALF_WIDTH} y2={pos.y - 56} className="class-divider" />
            <line x1={pos.x - NODE_HALF_WIDTH} y1={pos.y + 8} x2={pos.x + NODE_HALF_WIDTH} y2={pos.y + 8} className="class-divider" />
            <text x={pos.x} y={pos.y - 70} className="node-id">
              {node.title}
            </text>
            {attributes.map((attr, index) => (
              <text key={attr} x={pos.x - 136} y={pos.y - 30 + index * 17} className="class-detail">
                {attr.replace(/^ATTRIBUTES?:\s*/i, '').slice(0, 42)}
              </text>
            ))}
            {methods.map((method, index) => (
              <text key={method} x={pos.x - 136} y={pos.y + 26 + index * 17} className="class-detail">
                {method.replace(/^METHOD:\s*/i, '').slice(0, 42)}
              </text>
            ))}
          </g>
        )
      })}
    </svg>
  )
}

function renderUseCaseDiagram(diagram, selectedEntity, onSelect) {
  const USECASE_RX = 128
  const USECASE_RY = 44
  const actorNodes = diagram.nodes.filter((node) => /actor/i.test(node.subtitle) || /actor/i.test(node.label))
  const useCaseNodes = diagram.nodes.filter((node) => !actorNodes.includes(node))

  const actorPositions = {
    A1: { x: 150, y: 250 },
    A2: { x: 1450, y: 300 },
    A3: { x: 1450, y: 700 },
    A4: { x: 150, y: 1110 },
  }

  const useCasePositions = {
    UC1: { x: 780, y: 115 },
    UC2: { x: 500, y: 270 },
    UC3: { x: 520, y: 430 },
    UC4: { x: 1020, y: 345 },
    UC5: { x: 1035, y: 505 },
    UC6: { x: 780, y: 645 },
    UC7: { x: 580, y: 815 },
    UC8: { x: 945, y: 815 },
    UC9: { x: 930, y: 965 },
    UC10: { x: 955, y: 1115 },
    UC11: { x: 560, y: 1235 },
    UC12: { x: 590, y: 1375 },
    UC13: { x: 1020, y: 1275 },
    UC14: { x: 1025, y: 1415 },
    UC15: { x: 780, y: 1560 },
  }

  actorNodes.forEach((node, index) => {
    if (!actorPositions[node.id]) {
      const side = index % 2 === 0 ? 150 : CANVAS_WIDTH - 150
      const row = Math.floor(index / 2)
      actorPositions[node.id] = { x: side, y: 250 + row * 360 }
    }
  })

  useCaseNodes.forEach((node, index) => {
    if (!useCasePositions[node.id]) {
      const row = Math.floor(index / 3)
      const col = index % 3
      useCasePositions[node.id] = { x: 470 + col * 290, y: 230 + row * 160 }
    }
  })

  const allPositions = { ...actorPositions, ...useCasePositions }
  const actorIds = new Set(actorNodes.map((n) => n.id))
  const relationshipLabelPositions = {
    I1: { x: 1010, y: 425 },
    I2: { x: 908, y: 525 },
    I3: { x: 575, y: 540 },
    I4: { x: 965, y: 895 },
    I5: { x: 1020, y: 1045 },
    I6: { x: 585, y: 1305 },
    E1: { x: 795, y: 1148 },
  }

  return (
    <svg viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT + 760}`} className="diagram-svg" role="img" aria-label={diagram.title}>
      <defs>
        <marker id="arrow-use" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" className="arrowhead-shape" />
        </marker>
      </defs>

      <rect x="280" y="20" width="960" height="1610" rx="20" className="system-boundary" />
      <text x="760" y="44" className="boundary-title usecase-boundary-title">
        CampusConnect system
      </text>

      {diagram.links.map((link) => {
        const rawSrc = allPositions[link.source]
        const rawTgt = allPositions[link.target]
        if (!rawSrc || !rawTgt) {
          return null
        }
        const isSelected = selectedEntity?.kind === 'link' && selectedEntity.id === link.id
        const isIncludeOrExtend = /INCLUDE|EXTEND/i.test(link.relationType)
        const srcPt = actorIds.has(link.source) ? getActorAnchor(rawSrc, rawTgt) : getEllipseAnchor(rawSrc, rawTgt, USECASE_RX, USECASE_RY)
        const tgtPt = actorIds.has(link.target) ? getActorAnchor(rawTgt, rawSrc) : getEllipseAnchor(rawTgt, rawSrc, USECASE_RX, USECASE_RY)
        const d = `M ${srcPt.x} ${srcPt.y} L ${tgtPt.x} ${tgtPt.y}`

        return (
          <g key={`${link.id}-line`} className="link-group" onClick={() => onSelect({ kind: 'link', entity: link })}>
            <path
              d={d}
              className={isSelected ? 'diagram-link selected' : 'diagram-link'}
              markerEnd={isIncludeOrExtend ? 'url(#arrow-use)' : undefined}
              strokeDasharray={isIncludeOrExtend ? '7 6' : 'none'}
            />
            <path d={d} className="link-hitbox" />
          </g>
        )
      })}

      {actorNodes.map((node) => {
        const pos = actorPositions[node.id]
        const isSelected = selectedEntity?.kind === 'node' && selectedEntity.id === node.id
        return (
          <g key={node.id} className="node-group" onClick={() => onSelect({ kind: 'node', entity: node })}>
            <circle cx={pos.x} cy={pos.y - 36} r="16" className={isSelected ? 'actor-shape selected' : 'actor-shape'} />
            <line x1={pos.x} y1={pos.y - 20} x2={pos.x} y2={pos.y + 20} className={isSelected ? 'actor-line selected' : 'actor-line'} />
            <line x1={pos.x - 20} y1={pos.y - 2} x2={pos.x + 20} y2={pos.y - 2} className={isSelected ? 'actor-line selected' : 'actor-line'} />
            <line x1={pos.x} y1={pos.y + 20} x2={pos.x - 16} y2={pos.y + 48} className={isSelected ? 'actor-line selected' : 'actor-line'} />
            <line x1={pos.x} y1={pos.y + 20} x2={pos.x + 16} y2={pos.y + 48} className={isSelected ? 'actor-line selected' : 'actor-line'} />
            <text x={pos.x} y={pos.y + 70} className="node-id">
              {node.title}
            </text>
            <text x={pos.x} y={pos.y + 90} className="node-label">
              {getActorRoleLabel(node)}
            </text>
          </g>
        )
      })}

      {useCaseNodes.map((node) => {
        const pos = useCasePositions[node.id]
        const isSelected = selectedEntity?.kind === 'node' && selectedEntity.id === node.id
        return (
          <g key={node.id} className="node-group" onClick={() => onSelect({ kind: 'node', entity: node })}>
            <ellipse cx={pos.x} cy={pos.y} rx={USECASE_RX} ry={USECASE_RY} className={isSelected ? 'usecase-node selected' : 'usecase-node'} />
            <text x={pos.x} y={pos.y + 5} className="node-id usecase-node-text">
              {getUseCaseDisplayLabel(node)}
            </text>
          </g>
        )
      })}

      {diagram.links.map((link) => {
        const rawSrc = allPositions[link.source]
        const rawTgt = allPositions[link.target]
        if (!rawSrc || !rawTgt || !/INCLUDE|EXTEND/i.test(link.relationType)) {
          return null
        }

        const isSelected = selectedEntity?.kind === 'link' && selectedEntity.id === link.id
        const srcPt = actorIds.has(link.source) ? getActorAnchor(rawSrc, rawTgt) : getEllipseAnchor(rawSrc, rawTgt, USECASE_RX, USECASE_RY)
        const tgtPt = actorIds.has(link.target) ? getActorAnchor(rawTgt, rawSrc) : getEllipseAnchor(rawTgt, rawSrc, USECASE_RX, USECASE_RY)
        const labelPos = relationshipLabelPositions[link.id] || {
          x: (srcPt.x + tgtPt.x) / 2,
          y: (srcPt.y + tgtPt.y) / 2,
        }

        return (
          <g key={`${link.id}-label`} className="link-group" onClick={() => onSelect({ kind: 'link', entity: link })}>
            <text x={labelPos.x} y={labelPos.y} className={isSelected ? 'link-label-text usecase-relationship-label selected' : 'link-label-text usecase-relationship-label'}>
              {link.relationType === 'EXTEND' ? '<<extend>>' : '<<include>>'}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function DiagramCanvas({ diagram, selectedEntity, onSelect, diagramIndex }) {
  const kind = useMemo(() => getDiagramKind(diagram, diagramIndex), [diagram, diagramIndex])

  if (kind === 'sequence') {
    return renderSequenceDiagram(diagram, selectedEntity, onSelect, false)
  }

  if (kind === 'system-sequence') {
    return renderSequenceDiagram(diagram, selectedEntity, onSelect, true)
  }

  if (kind === 'domain-model') {
    return renderDomainModelDiagram(diagram, selectedEntity, onSelect)
  }

  if (kind === 'design-class') {
    return renderDesignClassDiagram(diagram, selectedEntity, onSelect)
  }

  return renderUseCaseDiagram(diagram, selectedEntity, onSelect)

  return (
    <svg viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`} className="diagram-svg" role="img" aria-label={diagram.title}>
      <defs>
        <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" className="arrowhead-shape" />
        </marker>
      </defs>

      {diagram.links.map((link) => {
        const source = positions[link.source]
        const target = positions[link.target]
        if (!source || !target) {
          return null
        }

        const selected = selectedEntity?.kind === 'link' && selectedEntity.id === link.id
        const midX = (source.x + target.x) / 2
        const midY = (source.y + target.y) / 2

        return (
          <g key={link.id} className="link-group" onClick={() => onSelect({ kind: 'link', entity: link })}>
            <line
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              className={selected ? 'diagram-link selected' : 'diagram-link'}
              markerEnd="url(#arrowhead)"
            />
            <line x1={source.x} y1={source.y} x2={target.x} y2={target.y} className="link-hitbox" />
            <rect x={midX - 70} y={midY - 16} width="140" height="32" rx="8" className="link-label-bg" />
            <text x={midX} y={midY + 5} className="link-label-text">
              {link.id}
            </text>
          </g>
        )
      })}

      {diagram.nodes.map((node) => {
        const pos = positions[node.id]
        if (!pos) {
          return null
        }

        const selected = selectedEntity?.kind === 'node' && selectedEntity.id === node.id
        const width = 220
        const height = 76

        return (
          <g key={node.id} className="node-group" onClick={() => onSelect({ kind: 'node', entity: node })}>
            <rect
              x={pos.x - width / 2}
              y={pos.y - height / 2}
              width={width}
              height={height}
              rx="16"
              className={selected ? 'diagram-node selected' : 'diagram-node'}
            />
            <text x={pos.x} y={pos.y - 8} className="node-id">
              {node.title}
            </text>
            <text x={pos.x} y={pos.y + 14} className="node-label">
              {node.subtitle || node.id}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function App() {
  const diagrams = useMemo(() => parseDiagrams(diagramText), [])
  if (diagrams.length === 0) {
    return <div className="app-shell">No diagrams were found in diagramstext.txt.</div>
  }

  const [activeTab, setActiveTab] = useState(0)
  const [selectedEntity, setSelectedEntity] = useState(null)
  const [infoOpen, setInfoOpen] = useState(false)
  const [openPanel, setOpenPanel] = useState('purpose')

  const activeDiagram = diagrams[activeTab]
  const teachingMeta = getTeachingMeta(activeDiagram, activeTab, diagrams)

  const processPreview = activeDiagram.links.slice(0, 6)

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="tab-row" role="tablist" aria-label="Diagram tabs">
          {diagrams.map((diagram, index) => (
            <button
              key={diagram.title}
              type="button"
              role="tab"
              aria-selected={activeTab === index}
              className={activeTab === index ? 'tab active' : 'tab'}
              onClick={() => {
                setActiveTab(index)
                setSelectedEntity(null)
                setOpenPanel('purpose')
              }}
            >
              {diagram.title.replace(/:\s*.+$/, '')}
            </button>
          ))}
        </div>
        <button type="button" className="info-button" aria-label="Open learning info" onClick={() => setInfoOpen(true)}>
          i
        </button>
      </header>

      <main className="workspace-grid">
        <aside className="left-panel">
          <h1>{activeDiagram.title}</h1>

          <section className={openPanel === 'purpose' ? 'accordion-panel open' : 'accordion-panel'}>
            <button
              type="button"
              className="accordion-header"
              onClick={() => setOpenPanel(openPanel === 'purpose' ? null : 'purpose')}
              aria-expanded={openPanel === 'purpose'}
            >
              Purpose
            </button>
            {openPanel === 'purpose' && (
              <div className="accordion-content">
                <p>{teachingMeta.purpose}</p>
              </div>
            )}
          </section>

          <section className={openPanel === 'process' ? 'accordion-panel open' : 'accordion-panel'}>
            <button
              type="button"
              className="accordion-header"
              onClick={() => setOpenPanel(openPanel === 'process' ? null : 'process')}
              aria-expanded={openPanel === 'process'}
            >
              Process To Build
            </button>
            {openPanel === 'process' && (
              <div className="accordion-content">
                <ol>
                  {teachingMeta.process.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                {processPreview.length > 0 && (
                  <div className="process-example">
                    <p>Example flow in this tab:</p>
                    {processPreview.map((link) => (
                      <p key={link.id}>
                        {link.id}: {link.relationLabel}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          <section className={openPanel === 'connects' ? 'accordion-panel open' : 'accordion-panel'}>
            <button
              type="button"
              className="accordion-header"
              onClick={() => setOpenPanel(openPanel === 'connects' ? null : 'connects')}
              aria-expanded={openPanel === 'connects'}
            >
              How It Connects
            </button>
            {openPanel === 'connects' && (
              <div className="accordion-content">
                <p>{teachingMeta.connectionText}</p>
              </div>
            )}
          </section>

          <section className={openPanel === 'justification' ? 'accordion-panel open selected-panel' : 'accordion-panel selected-panel'}>
            <button
              type="button"
              className="accordion-header"
              onClick={() => setOpenPanel(openPanel === 'justification' ? null : 'justification')}
              aria-expanded={openPanel === 'justification'}
            >
              Clicked Entity Justification
            </button>
            {openPanel === 'justification' && (
              <div className="accordion-content">
                {selectedEntity ? (
                  <>
                    <p className="entity-id">
                      {selectedEntity.kind === 'node' ? 'Node' : 'Relationship'}: {selectedEntity.id}
                    </p>
                    <p>{selectedEntity.justification}</p>
                    {selectedEntity.details && selectedEntity.details.length > 0 && (
                      <ul>
                        {selectedEntity.details.slice(0, 5).map((detail) => (
                          <li key={detail}>{detail}</li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : (
                  <p>Click any node or link in the diagram area to view its justification and supporting details.</p>
                )}
              </div>
            )}
          </section>

          <section className={openPanel === 'additional' ? 'accordion-panel open' : 'accordion-panel'}>
            <button
              type="button"
              className="accordion-header"
              onClick={() => setOpenPanel(openPanel === 'additional' ? null : 'additional')}
              aria-expanded={openPanel === 'additional'}
            >
              Additional text
            </button>
            {openPanel === 'additional' && (
              <div className="accordion-content">
                <p>{teachingMeta.dropdownText}</p>
              </div>
            )}
          </section>
        </aside>

        <section className="diagram-panel">
          <DiagramCanvas
            diagram={activeDiagram}
            selectedEntity={selectedEntity}
            diagramIndex={activeTab}
            onSelect={({ kind, entity }) => {
              setSelectedEntity({ kind, ...entity })
              setOpenPanel('justification')
            }}
          />
        </section>
      </main>

      {infoOpen && (
        <div className="modal-backdrop" role="presentation" onClick={() => setInfoOpen(false)}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Extra course information" onClick={(event) => event.stopPropagation()}>
            <h2>Course Diagram Guide</h2>
            <p>{teachingMeta.infoText}</p>
            <p>{teachingMeta.previous ? `Previous context: ${teachingMeta.previous}.` : 'This is the first modeling perspective in the sequence.'}</p>
            <p>{teachingMeta.next ? `Next context: ${teachingMeta.next}.` : 'This is the final synthesis perspective in the sequence.'}</p>
            <button type="button" onClick={() => setInfoOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
