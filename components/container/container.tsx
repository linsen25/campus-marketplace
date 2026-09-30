import classNames from 'classnames'

export type ContainerProps = {
  children: React.ReactNode
  className?: string
}

export function Container({ children, className }: ContainerProps) {
  return (
    <div
      className={classNames(
        'w-full max-w-6xl mx-auto p-2 laptop:px-4',
        className
      )}
    >
      {children}
    </div>
  )
}
