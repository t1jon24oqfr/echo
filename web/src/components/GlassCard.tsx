export default function GlassCard({
  children,
  strong,
  style,
}: {
  children: React.ReactNode;
  strong?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div className={strong ? 'glass-strong' : 'card'} style={{ padding: 16, ...style }}>
      {children}
    </div>
  );
}
