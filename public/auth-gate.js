(function(root){
  root.shouldGateOnReopen=function({security,localUnlockMarker}={}){
    const unlockedUntil=Date.parse(security?.unlockedUntil||'');
    const sessionUnlocked=security?.unlocked===true&&Number.isFinite(unlockedUntil)&&unlockedUntil>Date.now();
    if(!sessionUnlocked)return true;
    return security?.passkeySet===true&&!localUnlockMarker;
  };
})(window);
