import * as React from 'react'

interface PreviewErrorStateProps {
  message: string
}

export function PreviewErrorState({ message }: PreviewErrorStateProps): React.ReactElement {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-muted-foreground">
      {message}
    </div>
  )
}
