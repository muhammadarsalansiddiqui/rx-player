import React from "react";
import { Subject } from "rxjs";
import { takeUntil } from "rxjs/operators";
import { createModule } from "../lib/vespertine.js";
import PlayerModule from "../modules/player";
import ControlBar from "./ControlBar.jsx";
import ContentList from "./ContentList.jsx";
import ErrorDisplayer from "./ErrorDisplayer.jsx";
import LogDisplayer from "./LogDisplayer.jsx";
import ChartsManager from "./charts/index.jsx";
import PlayerKnobsSettings from "./PlayerKnobsSettings.jsx";

// time in ms while seeking/loading/buffering after which the spinner is shown
const SPINNER_TIMEOUT = 300;

class Player extends React.Component {
  constructor(...args) {
    super(...args);
    this.state = {
      player: null,
      autoPlayBlocked: false,
      displaySpinner: false,
      displaySettings: false,
      isStopped: true,
      enableVideoThumbnails: false,
    };
  }

  componentDidMount() {
    const player = createModule(PlayerModule, {
      videoElement: this.videoElement,
      textTrackElement: this.textTrackElement,
    });

    this._$destroySubject = new Subject();
    this._$destroySubject.subscribe(() => player.destroy());

    // update isStopped and displaySpinner
    player.$get("autoPlayBlocked" ,
                "isSeeking",
                "isBuffering",
                "isLoading",
                "isReloading",
                "isStopped")
      .pipe(takeUntil(this._$destroySubject))
      .subscribe(([
        autoPlayBlocked,
        isSeeking,
        isBuffering,
        isLoading,
        isReloading,
        isStopped,
      ]) => {
        this.setState({ autoPlayBlocked, isStopped });
        if (isLoading || isReloading) {
          this.setState({ displaySpinner: true });
        } else if (isSeeking || isBuffering) {
          if (this._displaySpinnerTimeout) {
            clearTimeout(this._displaySpinnerTimeout);
          }
          this._displaySpinnerTimeout = setTimeout(() => {
            this.setState({ displaySpinner: true });
          }, SPINNER_TIMEOUT);
        } else {
          if (this._displaySpinnerTimeout) {
            clearTimeout(this._displaySpinnerTimeout);
            this._displaySpinnerTimeout = 0;
          }

          if (this.state.displaySpinner) {
            this.setState({ displaySpinner: false });
          }
        }
      });

    this.setState({ player });
    // for DEV mode
    window.playerModule = player;
  }

  // will never happen, but still
  componentWillUnmount() {
    if (this._$destroySubject) {
      this._$destroySubject.next();
      this._$destroySubject.complete();
    }
    if (this._displaySpinnerTimeout) {
      clearTimeout(this._displaySpinnerTimeout);
    }
  }

  onVideoClick() {
    const { isPaused, isContentLoaded } =
      this.state.player.get();

    if (!isContentLoaded) {
      return;
    }

    if (isPaused) {
      this.state.player.dispatch("PLAY");
    } else {
      this.state.player.dispatch("DISABLE_LIVE_CATCH_UP");
      this.state.player.dispatch("PAUSE");
    }
  }

  render() {
    const { player,
            autoPlayBlocked,
            displaySpinner,
            isStopped,
            enableVideoThumbnails } = this.state;

    const loadVideo = (video) => {
      this.setState({ enableVideoThumbnails: video.enableVideoThumbnails });
      if (video.lowLatencyMode) {
        this.state.player.dispatch("ENABLE_LIVE_CATCH_UP");
      } else {
        this.state.player.dispatch("DISABLE_LIVE_CATCH_UP");
      }
      this.state.player.dispatch("SET_PLAYBACK_RATE", 1);
      this.state.player.dispatch("LOAD", video);
    };
    const stopVideo = () => this.state.player.dispatch("STOP");

    const closeSettings = () => {
      this.setState({ displaySettings: false });
    };
    const toggleSettings = () => {
      this.setState({ displaySettings: !this.state.displaySettings });
    };

    return (
      <section className="video-player-section">
        <div className="video-player-content">
          <ContentList
            loadVideo={loadVideo}
            isStopped={isStopped}
          />
          <div
            className="video-player-wrapper"
            ref={element => this.playerWrapperElement = element }
          >
            <div className="video-screen-parent">
              <div
                className="video-screen"
                onClick={() => this.onVideoClick()}
              >
                <ErrorDisplayer player={player} />
                {
                  autoPlayBlocked ?
                    <div className="video-player-manual-play-container" >
                      <img
                        className="video-player-manual-play"
                        alt="Play"
                        src="./assets/play.svg"/>
                    </div> :
                    null
                }
                {
                  !autoPlayBlocked && displaySpinner ?
                    <img
                      src="./assets/spinner.gif"
                      className="video-player-spinner"
                    /> :
                    null
                }
                <div
                  className="text-track"
                  ref={element => this.textTrackElement = element }
                />
                <video ref={element => this.videoElement = element }/>

              </div>
              <PlayerKnobsSettings
                close={closeSettings}
                shouldDisplay={this.state.displaySettings}
                player={player}
              />
            </div>
            {
              player ?
                <ControlBar
                  player={player}
                  videoElement={this.playerWrapperElement}
                  toggleSettings={toggleSettings}
                  stopVideo={stopVideo}
                  enableVideoThumbnails={enableVideoThumbnails}
                /> : null
            }
          </div>
          {player ?  <ChartsManager player={player} /> : null }
          {player ?  <LogDisplayer player={player} /> : null}
        </div>
      </section>
    );
  }
}

export default Player;
