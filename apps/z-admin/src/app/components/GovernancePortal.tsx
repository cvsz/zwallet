'use client';
import React from 'react';
// @ts-expect-error lucide-react types
import { Vote, FileText, Users, Clock, CheckCircle2, XCircle } from 'lucide-react';

interface Proposal {
  id: string;
  title: string;
  status: 'ACTIVE' | 'PASSED' | 'FAILED' | 'QUEUED';
  votesFor: string;
  votesAgainst: string;
  endsIn: string;
}

const proposals: Proposal[] = [
  { id: 'ZIP-001', title: 'Upgrade ZEASwap to v2.4 (Concentrated Liquidity)', status: 'ACTIVE', votesFor: '1.2M ZEA', votesAgainst: '104K ZEA', endsIn: '2d 4h' },
  { id: 'ZIP-002', title: 'Enable Arbitrum One Cross-Chain Bridge', status: 'QUEUED', votesFor: '2.5M ZEA', votesAgainst: '12K ZEA', endsIn: 'Completed' },
  { id: 'ZIP-003', title: 'Reduce Swap Fee to 0.25%', status: 'FAILED', votesFor: '400K ZEA', votesAgainst: '1.1M ZEA', endsIn: 'Closed' },
];

export default function GovernancePortal() {
  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-12 gap-6">
          <div>
            <h1 className="text-4xl font-black uppercase italic tracking-tighter text-white">DAO Governance</h1>
            <p className="text-slate-500 font-mono text-sm mt-1 uppercase">Protocol parameters controlled by ZEA holders.</p>
          </div>
          <div className="flex gap-4">
            <div className="industrial-panel p-4 flex flex-col items-center justify-center min-w-[120px]">
              <span className="text-[10px] text-slate-500 uppercase font-bold mb-1">Voting Power</span>
              <span className="text-xl font-black text-amber-500">42,000</span>
            </div>
            <button className="btn-industrial bg-amber-600 text-black px-8 py-3 font-black uppercase text-sm h-full self-stretch">
              Submit Proposal
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
          <div className="lg:col-span-2 space-y-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
              <h2 className="text-lg font-bold uppercase tracking-widest flex items-center gap-2">
                {/* @ts-expect-error lucide-react types */}
                <FileText className="w-5 h-5 text-amber-500" />
                Active Proposals
              </h2>
              <span className="text-xs font-mono text-slate-500">TOTAL: 14</span>
            </div>

            {proposals.map((p) => (
              <div key={p.id} className="industrial-panel hover:border-amber-600/50 transition-colors cursor-pointer group">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <span className="text-[10px] font-mono text-amber-500 bg-amber-500/10 px-2 py-0.5 border border-amber-500/20 mb-2 inline-block uppercase">
                      {p.id}
                    </span>
                    <h3 className="text-xl font-bold group-hover:text-amber-500 transition-colors">{p.title}</h3>
                  </div>
                  <div className={`status-tag ${
                    p.status === 'ACTIVE' ? 'bg-green-900/20 text-green-500 border-green-500/30' :
                    p.status === 'FAILED' ? 'bg-red-900/20 text-red-500 border-red-500/30' :
                    'bg-slate-900/20 text-slate-500 border-slate-800'
                  }`}>
                    {p.status}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-8 mb-6">
                  <div>
                    <div className="flex justify-between text-[10px] uppercase font-bold mb-1">
                      <span className="text-green-500">For</span>
                      <span>{p.votesFor}</span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-900 rounded-full">
                      <div className="h-full bg-green-500 w-[80%]" />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-[10px] uppercase font-bold mb-1">
                      <span className="text-red-500">Against</span>
                      <span>{p.votesAgainst}</span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-900 rounded-full">
                      <div className="h-full bg-red-500 w-[20%]" />
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 uppercase">
                  <div className="flex items-center gap-4">
                    {/* @ts-expect-error lucide-react types */}
                    <span className="flex items-center gap-1"><Users className="w-3 h-3" /> 242 VOTERS</span>
                    {/* @ts-expect-error lucide-react types */}
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> ENDS IN {p.endsIn}</span>
                  </div>
                  <button className="text-amber-500 font-bold hover:underline">Cast Vote →</button>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-8">
            <div className="industrial-panel">
              <h3 className="text-sm font-black uppercase italic mb-4 border-b border-slate-800 pb-2 text-amber-500">DAO Stats</h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-500 uppercase">Total Staked ZEA</span>
                  <span className="font-bold">12.4M</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-500 uppercase">Circulating Supply</span>
                  <span className="font-bold">100M</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-500 uppercase">Active Proposals</span>
                  <span className="font-bold text-amber-500">1</span>
                </div>
              </div>
            </div>

            <div className="industrial-panel bg-amber-600/5">
              <h3 className="text-sm font-black uppercase italic mb-4 text-white">Delegation</h3>
              <p className="text-xs text-slate-400 mb-6 leading-relaxed">
                You can delegate your voting power to a trusted community member or a specialized audit firm.
              </p>
              <button className="w-full py-2 bg-white text-black font-black uppercase text-[10px] hover:bg-slate-200 transition-colors">
                Delegate Power
              </button>
            </div>

            <div className="p-6 border border-slate-800 rounded-lg">
              <div className="flex items-center gap-2 mb-4">
                {/* @ts-expect-error lucide-react types */}
                <CheckCircle2 className="w-5 h-5 text-green-500" />
                <span className="text-xs font-bold uppercase tracking-widest text-slate-300">Quorum Progress</span>
              </div>
              <div className="h-4 w-full bg-slate-900 rounded-full overflow-hidden mb-2">
                <div className="h-full bg-amber-500 w-[65%]" />
              </div>
              <span className="text-[10px] text-slate-500 font-mono">65% OF MINIMUM QUORUM REACHED</span>
            </div>

            <div className="industrial-panel">
              <h3 className="text-[10px] font-black uppercase text-slate-500 mb-4 tracking-tighter">Live Activity Feed</h3>
              <div className="space-y-4">
                {[
                  { user: 'audit_firm.eth', action: 'VOTED FOR ZIP-001', time: '1m ago' },
                  { user: 'whale_alpha.eth', action: 'DELEGATED 500K ZEA', time: '12m ago' },
                  { user: 'dev_dao.eth', action: 'SUBMITTED ZIP-004', time: '1h ago' },
                ].map((act, i) => (
                  <div key={i} className="flex gap-3 items-start border-b border-slate-900 pb-3 last:border-0">
                    <div className="w-2 h-2 bg-amber-500 rounded-full mt-1 shrink-0 animate-pulse" />
                    <div>
                      <span className="text-[10px] font-mono text-amber-500 block">{act.user}</span>
                      <span className="text-[10px] text-white uppercase font-bold">{act.action}</span>
                      <span className="text-[8px] text-slate-600 block mt-0.5">{act.time}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
