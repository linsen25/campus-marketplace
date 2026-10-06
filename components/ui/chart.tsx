'use client'

import type { CSSProperties, ReactElement, ReactNode } from 'react'
import { createContext, useContext } from 'react'
import { ResponsiveContainer, Tooltip } from 'recharts'

import styles from './chart.module.css'

export type ChartConfig = Record<string, { label: ReactNode; color: string }>
const ChartContext = createContext<ChartConfig>({})

// Minimal shadcn-compatible config/tooltip architecture, styled with CSS Modules.
export function ChartContainer({
  config,
  children,
  className = '',
}: {
  config: ChartConfig
  children: ReactElement
  className?: string
}) {
  const colors = Object.fromEntries(
    Object.entries(config).map(([key, value]) => [
      `--color-${key}`,
      value.color,
    ])
  ) as CSSProperties
  return (
    <ChartContext.Provider value={config}>
      <div
        className={`${styles.chart} ${className}`}
        style={colors}
        data-chart="true"
      >
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          {children}
        </ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  )
}

export const ChartTooltip = Tooltip

export function ChartTooltipContent({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: ReadonlyArray<{
    dataKey?: number | string
    value?: unknown
    name?: number | string
    color?: string
  }>
  label?: ReactNode
}) {
  const config = useContext(ChartContext)
  if (!active || !payload?.length) return null
  return (
    <div className={styles.tooltip}>
      <div className={styles.label}>{label}</div>
      {payload.map((item) => {
        const key = String(item.dataKey ?? item.name)
        return (
          <div key={key} className={styles.row}>
            <span
              className={styles.dot}
              style={{ background: config[key]?.color ?? item.color }}
            />
            <span>{config[key]?.label ?? item.name}</span>
            <strong>
              {typeof item.value === 'number'
                ? item.value.toLocaleString('en-US')
                : String(item.value ?? '')}
            </strong>
          </div>
        )
      })}
    </div>
  )
}
