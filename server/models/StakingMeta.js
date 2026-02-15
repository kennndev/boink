import mongoose from 'mongoose';

const stakingMetaSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: true }
);

export const StakingMeta = mongoose.model('StakingMeta', stakingMetaSchema);
