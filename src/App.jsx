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

  return (
    <svg viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`} className={svgClass} role="img" aria-label={diagram.title}>
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
          height={CANVAS_HEIGHT - (lifelineTop - 58) - 40}
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
            <line x1={pos.x} y1={lifelineTop + 18} x2={pos.x} y2={CANVAS_HEIGHT - 50} className="lifeline" />
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
  const positions = getGridPositions(diagram.nodes, CANVAS_WIDTH, 140, 3, 250)

  return (
    <svg viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT + 260}`} className="diagram-svg" role="img" aria-label={diagram.title}>
      <defs>
        <marker id="arrow-domain" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
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
        const labelX = (source.x + target.x) / 2
        const labelY = (source.y + target.y) / 2

        return (
          <g key={link.id} className="link-group" onClick={() => onSelect({ kind: 'link', entity: link })}>
            <line
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              className={isSelected ? 'diagram-link selected' : 'diagram-link'}
              markerEnd="url(#arrow-domain)"
            />
            <line x1={source.x} y1={source.y} x2={target.x} y2={target.y} className="link-hitbox" />
            <rect x={labelX - 88} y={labelY - 15} width="176" height="30" rx="8" className="link-label-bg" />
            <text x={labelX} y={labelY + 5} className="link-label-text">
              {link.id}: {link.relationLabel.slice(0, 14)}
            </text>
          </g>
        )
      })}

      {diagram.nodes.map((node) => {
        const pos = positions[node.id]
        const isSelected = selectedEntity?.kind === 'node' && selectedEntity.id === node.id
        const details = node.details.slice(0, 4)
        return (
          <g key={node.id} className="node-group" onClick={() => onSelect({ kind: 'node', entity: node })}>
            <rect x={pos.x - 132} y={pos.y - 72} width="264" height="154" rx="12" className={isSelected ? 'diagram-node class-node selected' : 'diagram-node class-node'} />
            <line x1={pos.x - 132} y1={pos.y - 36} x2={pos.x + 132} y2={pos.y - 36} className="class-divider" />
            <text x={pos.x} y={pos.y - 48} className="node-id">
              {node.title}
            </text>
            <text x={pos.x} y={pos.y - 16} className="node-label">
              {node.id}
            </text>
            {details.map((detail, index) => (
              <text key={detail} x={pos.x - 118} y={pos.y + 12 + index * 18} className="class-detail">
                {detail.replace(/^ATTRIBUTE:\s*/i, '').slice(0, 34)}
              </text>
            ))}
          </g>
        )
      })}
    </svg>
  )
}

function renderDesignClassDiagram(diagram, selectedEntity, onSelect) {
  const positions = getGridPositions(diagram.nodes, CANVAS_WIDTH, 140, 3, 280)

  return (
    <svg viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT + 320}`} className="diagram-svg" role="img" aria-label={diagram.title}>
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
        const labelX = (source.x + target.x) / 2
        const labelY = (source.y + target.y) / 2
        return (
          <g key={link.id} className="link-group" onClick={() => onSelect({ kind: 'link', entity: link })}>
            <line
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              className={isSelected ? 'diagram-link selected' : 'diagram-link'}
              markerEnd="url(#arrow-design)"
              strokeDasharray={isDependency ? '8 6' : 'none'}
            />
            <line x1={source.x} y1={source.y} x2={target.x} y2={target.y} className="link-hitbox" />
            <rect x={labelX - 90} y={labelY - 15} width="180" height="30" rx="8" className="link-label-bg" />
            <text x={labelX} y={labelY + 5} className="link-label-text">
              {link.id}: {link.relationType}
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
            <rect x={pos.x - 150} y={pos.y - 95} width="300" height="190" rx="10" className={isSelected ? 'diagram-node class-node selected' : 'diagram-node class-node'} />
            <line x1={pos.x - 150} y1={pos.y - 56} x2={pos.x + 150} y2={pos.y - 56} className="class-divider" />
            <line x1={pos.x - 150} y1={pos.y + 8} x2={pos.x + 150} y2={pos.y + 8} className="class-divider" />
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
  const actorNodes = diagram.nodes.filter((node) => /actor/i.test(node.subtitle) || /actor/i.test(node.label))
  const useCaseNodes = diagram.nodes.filter((node) => !actorNodes.includes(node))

  const actorPositions = {}
  const useCasePositions = {}

  actorNodes.forEach((node, index) => {
    const side = index % 2 === 0 ? 220 : CANVAS_WIDTH - 220
    const row = Math.floor(index / 2)
    actorPositions[node.id] = { x: side, y: 210 + row * 220 }
  })

  const useCols = 3
  const useGapX = 760 / useCols
  useCaseNodes.forEach((node, index) => {
    const row = Math.floor(index / useCols)
    const col = index % useCols
    useCasePositions[node.id] = {
      x: 430 + useGapX * col,
      y: 170 + row * 145,
    }
  })

  const allPositions = { ...actorPositions, ...useCasePositions }

  return (
    <svg viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT + 280}`} className="diagram-svg" role="img" aria-label={diagram.title}>
      <defs>
        <marker id="arrow-use" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" className="arrowhead-shape" />
        </marker>
      </defs>

      <rect x="350" y="90" width="900" height="1020" rx="16" className="system-boundary" />
      <text x="372" y="122" className="boundary-title">
        CampusConnect System Boundary
      </text>

      {diagram.links.map((link) => {
        const source = allPositions[link.source]
        const target = allPositions[link.target]
        if (!source || !target) {
          return null
        }
        const isSelected = selectedEntity?.kind === 'link' && selectedEntity.id === link.id
        const isIncludeOrExtend = /INCLUDE|EXTEND/i.test(link.relationType)
        const labelX = (source.x + target.x) / 2
        const labelY = (source.y + target.y) / 2

        return (
          <g key={link.id} className="link-group" onClick={() => onSelect({ kind: 'link', entity: link })}>
            <line
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              className={isSelected ? 'diagram-link selected' : 'diagram-link'}
              markerEnd="url(#arrow-use)"
              strokeDasharray={isIncludeOrExtend ? '7 6' : 'none'}
            />
            <line x1={source.x} y1={source.y} x2={target.x} y2={target.y} className="link-hitbox" />
            <rect x={labelX - 90} y={labelY - 15} width="180" height="30" rx="8" className="link-label-bg" />
            <text x={labelX} y={labelY + 5} className="link-label-text">
              {link.id}: {link.relationType}
            </text>
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
              {node.subtitle || node.id}
            </text>
          </g>
        )
      })}

      {useCaseNodes.map((node) => {
        const pos = useCasePositions[node.id]
        const isSelected = selectedEntity?.kind === 'node' && selectedEntity.id === node.id
        return (
          <g key={node.id} className="node-group" onClick={() => onSelect({ kind: 'node', entity: node })}>
            <ellipse cx={pos.x} cy={pos.y} rx="128" ry="44" className={isSelected ? 'usecase-node selected' : 'usecase-node'} />
            <text x={pos.x} y={pos.y - 2} className="node-id">
              {node.title}
            </text>
            <text x={pos.x} y={pos.y + 18} className="node-label">
              {node.id}
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
