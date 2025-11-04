interface DesktopIconProps {
  icon: string;
  label: string;
  onClick: () => void;
}

export const DesktopIcon = ({ icon, label, onClick }: DesktopIconProps) => {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-0.5 p-1 sm:p-2 hover:bg-primary/20 rounded transition-colors group 
                 w-20 sm:w-24 md:w-28 touch-target"
    >
      <img
        src={icon}
        alt={label}
        className="w-14 h-14 sm:w-12 sm:h-12 md:w-14 md:h-14 pixelated group-hover:scale-110 transition-transform"
      />
      <span className="text-[10px] sm:text-xs md:text-sm text-white font-bold text-center 
                       drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)] leading-tight">
        {label}
      </span>
    </button>
  );
};
